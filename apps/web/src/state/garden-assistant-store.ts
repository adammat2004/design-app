'use client';

import type { GardenChange } from '@garden-studio/schema';
import { create } from 'zustand';
import { ApiError, proposeGardenChanges } from '@/lib/plan-api';
import { useBoundaryStore } from './boundary-store';
import { useFeaturesStore } from './features-store';
import { flushAll } from './project-sync';
import { projectRevision } from './revision';

/**
 * Step 2's Garden Assistant conversation.
 *
 * A store of its own rather than fields on the features store, for the reason `assistant-store.ts`
 * gives: the chat is session state and the garden is document state, and rewinding the garden must
 * not rewind what was said about it.
 *
 * **The one deliberate difference from step 5's assistant: changes apply immediately.** There, a
 * diff rewrites a finished design and every line is worth reviewing. Here the user is describing a
 * garden that already exists, an approximate shed in roughly the right corner is the entire ask,
 * and a review queue between "I have a shed" and a shed appearing would make the assisted path
 * slower than drawing it by hand. The safety net is Undo, which reverses the whole turn at once —
 * see `features-store.applyAssistantChanges`.
 */

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  at: number;
}

export interface GardenAssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  at: number;
  /** What it tried to do, for the acknowledgement. Already applied by the time this exists. */
  changes: GardenChange[];
  /** Change ids that actually landed. Fewer than `changes` when the store refused one. */
  appliedIds: string[];
  /** Lines the store turned down at apply time, with the reason it gave. */
  refused: { changeId: string; reason: string }[];
  /** Set when this turn also changed which gardens are being redesigned. */
  scope: { zones: string[] } | null;
  suggestions: string[];
  /** Asked for but impossible to place, with the planner's reason. Never the model's words. */
  unplaceable: { description: string; reason: string }[];
}

export type GardenChatMessage = UserMessage | GardenAssistantMessage;

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `gm${messageCounter}`;
}

/**
 * The chips shown before anything has been said.
 *
 * Phrased as things a person would actually say about their own garden, not as commands — the
 * whole point of this panel is that it takes description rather than instruction.
 */
const OPENING_SUGGESTIONS = [
  'There is a shed in the back-left corner',
  'I have a patio outside the back doors',
  'Two mature trees along the right fence',
  'Only redesign the back garden',
];

interface GardenAssistantState {
  messages: GardenChatMessage[];
  pending: boolean;
  error: string | null;
  /**
   * Whether the drawer is showing. Only meaningful below `xl`: on a wide screen the panel is always
   * in the right-hand column, so there is nothing to open.
   */
  open: boolean;

  send: (text: string) => Promise<void>;
  setOpen: (open: boolean) => void;
  clear: () => void;
}

/**
 * Turns a transport failure into something worth reading.
 *
 * 503 is the expected one and is not really an error: it is what the API returns when it has no
 * Anthropic key, so `pnpm dev` and a marker without a key both land here. Saying "unavailable"
 * rather than "failed" is the difference between a feature that is switched off and one that is
 * broken — and the whole screen still works without it.
 */
function messageForFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503)
      return 'The assistant is unavailable — you can still add features by hand.';
    if (error.status === 429) return 'That was a lot of requests at once — try again in a minute.';
    if (error.status === 502)
      return 'The assistant replied with something unusable. Try rephrasing.';
  }

  return 'Could not reach the assistant. Check your connection and try again.';
}

export const useGardenAssistantStore = create<GardenAssistantState>((set, get) => ({
  messages: [],
  pending: false,
  error: null,
  open: false,

  setOpen: (open) => set({ open }),

  send: async (text) => {
    const trimmed = text.trim();
    if (trimmed === '' || get().pending) return;

    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextMessageId(), role: 'user', text: trimmed, at: Date.now() },
      ],
      pending: true,
      error: null,
    }));

    try {
      /*
       * Flush first. The request carries only the sentence — the server reads the plan it has
       * stored — so a feature placed inside the 800 ms autosave window would be invisible to the
       * assistant, which would then cheerfully place a second shed on top of it.
       */
      await flushAll();

      const target = projectRevision();
      if (!target) throw new Error('No plan is loaded.');

      const proposal = await proposeGardenChanges(target.projectId, trimmed);

      // Straight onto the canvas, as one undo entry. See the note at the top of this file.
      const outcome = useFeaturesStore.getState().applyAssistantChanges(proposal.changes);

      /*
       * Scope is a separate store and therefore a separate undo entry, which is recorded in the
       * plan's limitations rather than hidden: one history over both stores would make Undo mean
       * different things depending on which screen you were looking at.
       */
      if (proposal.scope) {
        const boundary = useBoundaryStore.getState();
        for (const zone of ['front', 'back', 'left', 'right'] as const) {
          const wanted = proposal.scope.zones.includes(zone);
          const has = boundary.present.selectedZoneIds.includes(zone);
          if (wanted !== has) boundary.toggleZone(zone);
        }
      }

      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: 'assistant',
            text: proposal.reply,
            at: Date.now(),
            changes: proposal.changes,
            appliedIds: outcome.applied,
            refused: outcome.refused,
            scope: proposal.scope,
            suggestions: proposal.suggestions,
            unplaceable: proposal.unplaceable,
          },
        ],
        pending: false,
      }));
    } catch (error) {
      // No assistant bubble on failure. An invented reply in the transcript would be
      // indistinguishable from one the model actually wrote.
      set({ pending: false, error: messageForFailure(error) });
    }
  },

  clear: () => set({ messages: [], pending: false, error: null }),
}));

/** The newest set of chips, or the opening set before anything has been said. */
export function latestGardenSuggestions(state: Pick<GardenAssistantState, 'messages'>): string[] {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message?.role === 'assistant' && message.suggestions.length > 0) return message.suggestions;
  }

  return OPENING_SUGGESTIONS;
}

/** Test hook: the store is a module singleton, so suites must reset it between cases. */
export function resetGardenAssistantStoreForTests(): void {
  messageCounter = 0;
  useGardenAssistantStore.setState({ messages: [], pending: false, error: null, open: false });
}
