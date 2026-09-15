'use client';

import type {
  AssistantTurn,
  DesignElement,
  DesignIntent,
  DesignRun,
  ProposedChange,
} from '@garden-studio/schema';
import { create } from 'zustand';
import { ApiError, assistantAvailability, proposeChanges, requestRedesign } from '@/lib/plan-api';
import { runFromProposal } from '@/lib/ai-run/from-proposal';
import { composeOutcome, type AgentOutcome } from '@/lib/ai-run/outcome';
import type { ReviewOffer, ReviewOutcome } from '@/lib/ai-run/review-loop';
import { selectRunActive, useAiRunStore } from './ai-run-store';
import { usePlanEditorStore } from './plan-editor-store';
import { flushAll } from './project-sync';
import { projectRevision } from './revision';

/**
 * The design agent's conversation.
 *
 * **One agent, not two.** There used to be a chat that handed you a diff to tick and apply, and
 * beside it a control surface that could only play a scripted demonstration or a review. So the
 * thing you could talk to could not act, and the thing you could watch acting could not be talked
 * to. This store is the join: you say what you want, and the designer performs it on the canvas.
 *
 * A store of its own rather than fields on the editor, because the conversation is session state and
 * the layout is document state. They have different lifetimes and different undo semantics:
 * rewinding the garden must not rewind what was said about it, and a transcript that vanished every
 * time someone pressed Undo would be useless as a record of how the plan got this way.
 *
 * The dependency runs one way. This store posts a sentence, turns the answer into a run, and hands
 * that to `ai-run-store`. The editor knows nothing about the conversation.
 */

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  at: number;
}

/**
 * What the designer is saying, and where it has got to.
 *
 * One message covers the whole life of a request — thinking, performing, reviewing, done — rather
 * than a new bubble per stage. The user asked one thing; a transcript that grew four entries for it
 * would read as four answers. It is also what makes a failure land *in* the reply it belongs to
 * rather than as a separate error line beside an orphaned "Working on it…".
 */
export interface AssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  at: number;
  status: 'thinking' | 'performing' | 'reviewing' | 'done' | 'failed' | 'stopped';
  changes: ProposedChange[];
  /** Asked for but impossible to place, with the planner's reason. Never the model's words. */
  unplaceable: { description: string; reason: string }[];
  /**
   * What actually happened, measured from the garden once it had.
   *
   * Deliberately **not** a revision id as well. The run store holds the revision and is the only
   * thing that can undo, compare or replay it; a second copy of its identity here is a second thing
   * to keep in step, and the one that went stale would be the one the buttons read.
   */
  outcome: AgentOutcome | null;
  suggestions: string[];
  /** Faults the reviewer found outside this request, offered rather than performed. */
  offers: ReviewOffer[];
}

export type ChatMessage = UserMessage | AssistantMessage;

/** Where the request in flight has got to. Drives the input, the chips and the pinned block. */
export type AgentPhase = 'idle' | 'thinking' | 'performing' | 'reviewing';

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `m${messageCounter}`;
}

/**
 * The chips shown before anything has been said.
 *
 * Generic, and deliberately not derived from the plan: the server writes every later set of
 * suggestions, and a client that generated its own opening set from the layout would be a second
 * source of designer copy to keep in step with the first.
 */
const OPENING_SUGGESTIONS = [
  'Make it better for entertaining',
  'Add more privacy',
  'More lawn',
  'Lower the cost',
];

/** How much of the conversation goes back with the next request. See `ProposeRequestSchema`. */
const HISTORY_TURNS = 4;
const HISTORY_CHARS = 600;

interface AgentState {
  messages: ChatMessage[];
  phase: AgentPhase;
  /**
   * Whether this server can interpret a sentence at all. Null until the probe answers.
   *
   * Three states rather than two, because "we have not asked yet" and "there is no key" want
   * different screens: the first is the ordinary opening, the second disables the input and says
   * why. Guessing either way would flash the wrong one.
   */
  available: boolean | null;

  send: (text: string) => Promise<void>;
  /** "Review my design", asked on its own: no request, so the whole plan is in scope. */
  reviewDesign: () => Promise<void>;
  /**
   * Plays a run that was built without asking the model, as a turn of the conversation.
   *
   * The demonstration is what uses this. It goes through the conversation rather than round the
   * side of it for two reasons: the user gets Stop, Undo and the outcome that every other request
   * gets, and the transcript does not acquire a garden that changed with nothing saying why.
   */
  playRun: (run: DesignRun, request: string, intent: string) => Promise<void>;
  /** Accepts one of the reviewer's offers and performs it, as its own sentence. */
  acceptOffer: (messageId: string, issueKey: string) => Promise<void>;
  /** Asks the server whether it has a key. Called once when the editor opens. */
  probeAvailability: () => Promise<void>;
  /** Abandons whatever is in flight and closes the bracket. For a screen going away under it. */
  abandon: () => void;
  clear: () => void;
}

/**
 * Turns a transport failure into something worth reading.
 *
 * 503 is the expected one and is not really an error: it is what the API returns when it has no
 * Anthropic key, so `pnpm dev` and a marker without a key both land here. Saying "unavailable"
 * rather than "failed" is the difference between a feature that is switched off and one that
 * is broken.
 */
function messageForFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return 'The designer is unavailable at the moment.';
    if (error.status === 429) return 'That was a lot of requests at once — try again in a minute.';
    if (error.status === 502)
      return 'The designer replied with something unusable. Try rephrasing.';
  }

  return 'Could not reach the designer. Check your connection and try again.';
}

/**
 * Whether the person watching has asked not to be animated at.
 *
 * Read at send time rather than subscribed to: changing the system setting mid-run and having the
 * animation vanish underneath would be its own kind of jolt. Defensive about `matchMedia` because
 * jsdom does not implement it.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The request in flight, so the screen going away can abandon it.
 *
 * Module state rather than store state for the reason the run controller is: an `AbortController`
 * is a live object with listeners on it, and it has no business in a snapshot React compares by
 * identity.
 */
let inFlight: AbortController | null = null;

/** True once the request in flight has been abandoned, so its tail stops rather than carries on. */
function abandoned(signal: AbortSignal): boolean {
  return signal.aborted;
}

export const useAssistantStore = create<AgentState>((set, get) => {
  /** Rewrites one assistant message in place. Every stage of a request edits the same bubble. */
  function patch(id: string, changes: Partial<AssistantMessage>): void {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id && message.role === 'assistant' ? { ...message, ...changes } : message,
      ),
    }));
  }

  /** The last few turns, oldest first, as they go back to the server. */
  function history(): AssistantTurn[] {
    const turns: AssistantTurn[] = [];
    for (let i = get().messages.length - 1; i >= 0 && turns.length < HISTORY_TURNS; i -= 1) {
      const message = get().messages[i]!;
      /*
       * A failed turn is left out. It carries a transport message — "could not reach the
       * designer" — which is not something the designer said about the garden, and quoting it back
       * as its own words is how a model comes to apologise for an outage it had no part in.
       */
      if (message.role === 'assistant' && message.status === 'failed') continue;
      if (message.text.trim() === '') continue;
      turns.push({ role: message.role, text: message.text.slice(0, HISTORY_CHARS) });
    }
    return turns.reverse();
  }

  /**
   * Everything after the model has answered: perform it, review it, say what happened.
   *
   * Shared by `send` and `acceptOffer`, because an offer accepted is a request the user made by
   * pressing a chip rather than typing — the same bracket, the same review, the same outcome.
   * Returns nothing; it reports by rewriting the message.
   */
  async function perform(
    messageId: string,
    changes: ProposedChange[],
    request: string,
    unplaceable: { description: string; reason: string }[],
    signal: AbortSignal,
  ): Promise<void> {
    const run = usePlanEditorStore.getState();
    const initial = run.present.elements;

    const refusals = unplaceable.map((entry) => ({
      label: entry.description,
      reason: entry.reason,
    }));

    const built = runFromProposal(changes, request, `agent-${messageId}`);

    /*
     * Nothing to do is a real answer, not a failure. Either they asked a question, or every line
     * the model wanted was refused by the planner before the run existed — and in the second case
     * the reasons are the whole of what there is to say.
     */
    if (!built) {
      patch(messageId, {
        status: 'done',
        outcome: composeOutcome({ initial, result: initial, refused: refusals }),
      });
      return;
    }

    set({ phase: 'performing' });
    patch(messageId, { status: 'performing' });

    let stopped = false;

    if (prefersReducedMotion()) {
      /*
       * Applied at once rather than animated.
       *
       * This is why `applyProposal` was kept rather than deleted with the tick-and-apply UI: without
       * it the feature is unusable for anyone with vestibular sensitivity, who would otherwise have
       * twenty seconds of movement they cannot opt out of. `withinGesture` because the sentence
       * already holds the bracket — see `applyProposal`.
       */
      const applied = usePlanEditorStore
        .getState()
        .applyProposal(changes, changes.map((change) => change.id), { withinGesture: true });

      for (const entry of applied.refused) {
        const change = changes.find((candidate) => candidate.id === entry.changeId);
        refusals.push({ label: change?.label ?? 'A change', reason: entry.reason });
      }
    } else {
      const played = await useAiRunStore.getState().playAndWait(built);
      stopped = played === 'cancelled';

      for (const entry of useAiRunStore.getState().refused) {
        refusals.push({ label: entry.label, reason: entry.reason });
      }
    }

    if (abandoned(signal)) return;

    /*
     * The review pass, scoped to what this request touched.
     *
     * Skipped after a stop, which is the one case where more work is plainly not wanted: the user
     * has just said they have seen enough.
     */
    let review: ReviewOutcome | null = null;
    if (!stopped) {
      const subjects = changes
        .map((change) => change.elementId)
        .filter((id): id is string => id !== null);

      set({ phase: 'reviewing' });
      patch(messageId, { status: 'reviewing' });
      review = await useAiRunStore.getState().review({ subjects });
    }

    if (abandoned(signal)) return;

    const result = usePlanEditorStore.getState().present.elements;
    patch(messageId, {
      status: stopped ? 'stopped' : 'done',
      outcome: composeOutcome({ initial, result, refused: refusals, review, stopped }),
      offers: review?.offers ?? [],
    });
  }

  /** Opens the sentence, runs `body`, and closes the bracket whatever happens. */
  async function sentence(
    messageId: string,
    request: string,
    body: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (!useAiRunStore.getState().beginSentence()) {
      patch(messageId, {
        status: 'failed',
        text: 'Finish the change you are making on the canvas first.',
      });
      set({ phase: 'idle' });
      return;
    }

    const controller = new AbortController();
    inFlight = controller;

    try {
      await body(controller.signal);
    } catch (error) {
      /*
       * The failure lands in the bubble already on screen.
       *
       * A separate error line beside a stranded "thinking…" bubble is two pieces of state saying
       * different things about one request, and the abandoned bubble then goes into the history as
       * something the designer supposedly said.
       */
      if (!abandoned(controller.signal)) {
        patch(messageId, { status: 'failed', text: messageForFailure(error) });
      }
    } finally {
      /* One bracket per sentence, closed exactly once, whichever way the tail ended. */
      useAiRunStore.getState().endSentence(request);
      if (inFlight === controller) inFlight = null;
      set({ phase: 'idle' });
    }
  }

  return {
    messages: [],
    phase: 'idle',
    available: null,

    probeAvailability: async () => {
      try {
        const { model } = await assistantAvailability();
        set({ available: model });
      } catch {
        /*
         * A probe that cannot reach the server leaves `available` null rather than false. "There is
         * no key" is a claim about configuration, and an API that is simply not running yet is not
         * evidence for it — the request itself will say what is wrong, in its own words.
         */
      }
    },

    send: async (text) => {
      const trimmed = text.trim();
      if (trimmed === '' || get().phase !== 'idle') return;
      if (selectRunActive(useAiRunStore.getState())) return;

      /*
       * Taken before the bubbles go up, or the request would carry itself.
       *
       * `message` and the last entry of `history` would be the same sentence, which reads to the
       * model as the user saying it twice — and, worse, pushes the turn that actually explains it
       * off the end of the four-turn window.
       */
      const turns = history();

      const id = nextMessageId();
      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: 'user', text: trimmed, at: Date.now() },
          {
            id,
            role: 'assistant',
            text: '',
            at: Date.now(),
            status: 'thinking',
            changes: [],
            unplaceable: [],
            outcome: null,
            suggestions: [],
            offers: [],
          },
        ],
        phase: 'thinking',
      }));

      await sentence(id, trimmed, async (signal) => {
        /*
         * Flush first. The request carries only the sentence and the conversation — the server
         * reads the plan it has stored — so asking inside the 800 ms autosave window would have the
         * designer reasoning about a garden the user can no longer see.
         */
        await flushAll();

        const target = projectRevision();
        if (!target) throw new Error('No plan is loaded.');

        const proposal = await proposeChanges(target.projectId, trimmed, turns, signal);
        if (abandoned(signal)) return;

        patch(id, {
          text: proposal.reply,
          changes: proposal.changes,
          unplaceable: proposal.unplaceable,
          suggestions: proposal.suggestions,
        });

        await perform(id, proposal.changes, trimmed, proposal.unplaceable, signal);
      });
    },

    playRun: async (run, request, intent) => {
      if (get().phase !== 'idle') return;
      if (selectRunActive(useAiRunStore.getState())) return;

      const id = nextMessageId();
      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: 'user', text: request, at: Date.now() },
          {
            id,
            role: 'assistant',
            text: intent,
            at: Date.now(),
            status: 'performing',
            changes: [],
            unplaceable: [],
            outcome: null,
            suggestions: [],
            offers: [],
          },
        ],
        phase: 'performing',
      }));

      await sentence(id, request, async (signal) => {
        const initial = usePlanEditorStore.getState().present.elements;
        const played = await useAiRunStore.getState().playAndWait(run);
        if (abandoned(signal)) return;

        /*
         * No review pass afterwards. This run carries its own review stage in its script, and a
         * second reviewer reading the same garden straight after would be the panel saying
         * "Review" twice about one piece of work.
         */
        const result = usePlanEditorStore.getState().present.elements;
        patch(id, {
          status: played === 'cancelled' ? 'stopped' : 'done',
          outcome: composeOutcome({
            initial,
            result,
            refused: useAiRunStore.getState().refused.map((entry) => ({
              label: entry.label,
              reason: entry.reason,
            })),
            stopped: played === 'cancelled',
          }),
        });
      });
    },

    reviewDesign: async () => {
      if (get().phase !== 'idle') return;
      if (selectRunActive(useAiRunStore.getState())) return;

      const id = nextMessageId();
      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: 'user', text: 'Review my design', at: Date.now() },
          {
            id,
            role: 'assistant',
            text: 'I will read the whole plan and fix the worst thing I can find.',
            at: Date.now(),
            status: 'reviewing',
            changes: [],
            unplaceable: [],
            outcome: null,
            suggestions: [],
            offers: [],
          },
        ],
        phase: 'reviewing',
      }));

      await sentence(id, 'Review my design', async (signal) => {
        const initial = usePlanEditorStore.getState().present.elements;
        /* No subjects: asked on its own, the whole plan is what the review is about. */
        const review = await useAiRunStore.getState().review({});
        if (abandoned(signal)) return;

        const result = usePlanEditorStore.getState().present.elements;
        patch(id, {
          status: 'done',
          outcome: composeOutcome({ initial, result, refused: [], review }),
          offers: review?.offers ?? [],
        });
      });
    },

    acceptOffer: async (messageId, issueKey) => {
      if (get().phase !== 'idle') return;
      if (selectRunActive(useAiRunStore.getState())) return;

      const source = get().messages.find(
        (message): message is AssistantMessage =>
          message.id === messageId && message.role === 'assistant',
      );
      const offer = source?.offers.find((candidate) => keyOf(candidate) === issueKey);
      if (!offer) return;

      const request = offer.issue.message;
      const id = nextMessageId();
      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: 'user', text: request, at: Date.now() },
          {
            id,
            role: 'assistant',
            text: 'I will see to that.',
            at: Date.now(),
            status: 'thinking',
            changes: [],
            unplaceable: [],
            outcome: null,
            suggestions: [],
            offers: [],
          },
        ],
        phase: 'thinking',
      }));

      /* The chip is spent whichever way this goes: offering it twice invites doing it twice. */
      patch(messageId, {
        offers: source!.offers.filter((candidate) => keyOf(candidate) !== issueKey),
      });

      await sentence(id, request, async (signal) => {
        const target = projectRevision();
        if (!target) throw new Error('No plan is loaded.');

        const elements = usePlanEditorStore.getState().present.elements;
        const changes = await proposeFromIntents(target.projectId, offer.intents, elements, signal);
        if (abandoned(signal)) return;

        await perform(id, changes, request, [], signal);
      });
    },

    abandon: () => {
      inFlight?.abort();
      inFlight = null;
      /*
       * The run in flight settles rather than stops: it keeps what it was doing and finishes at
       * once. Its own `finished` closes the sentence when the run opened one; when this store did,
       * the `finally` above closes it. Either way no bracket outlives the screen.
       */
      useAiRunStore.getState().settle();
      set({ phase: 'idle' });
    },

    clear: () => {
      set({ messages: [], phase: 'idle' });
    },
  };
});

/**
 * Asks the planner directly, with no model in the loop.
 *
 * An accepted offer already carries its intents — the reviewer worked them out when it decided not
 * to act on the fault — so there is nothing left to interpret, and routing it through the model
 * would make a free deterministic correction into a paid call that can fail. It is also why an
 * offer works on a server that has never had a key.
 */
async function proposeFromIntents(
  projectId: string,
  intents: DesignIntent[],
  elements: DesignElement[],
  signal: AbortSignal,
): Promise<ProposedChange[]> {
  return (await requestRedesign(projectId, intents, elements, signal)).changes;
}

/** What identifies an offer in the DOM and in `acceptOffer`. The fault and what it is about. */
export function keyOf(offer: ReviewOffer): string {
  return `${offer.issue.code}:${offer.issue.subjects.join(',')}`;
}

/* ---------------------------------------------------------------- derived reads */

/** The newest reply's chips, or the opening set before anything has been said. */
export function latestSuggestions(state: { messages: ChatMessage[] }): string[] {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (message.role === 'assistant' && message.suggestions.length > 0) return message.suggestions;
  }

  return OPENING_SUGGESTIONS;
}

/**
 * Whether the designer has the plan — which is what disables the input, Undo and Continue.
 *
 * Both halves, and that is the point. `selectRunActive` alone leaves Undo live while the model is
 * still thinking, which is a window where pressing it takes back the *previous* redesign and the
 * new one then lands on top of a garden nobody expected.
 */
export function selectAgentBusy(): boolean {
  return (
    useAssistantStore.getState().phase !== 'idle' || selectRunActive(useAiRunStore.getState())
  );
}

export function resetAssistantStoreForTests(): void {
  messageCounter = 0;
  inFlight?.abort();
  inFlight = null;
  useAssistantStore.setState({ messages: [], phase: 'idle', available: null });
}
