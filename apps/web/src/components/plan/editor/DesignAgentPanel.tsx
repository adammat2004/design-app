'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, SendHorizontal, Sparkles, Undo2 } from 'lucide-react';
import { buildDemoRun } from '@/lib/ai-run/demo-script';
import { layoutFingerprint } from '@/lib/concepts';
import { useRelativeTime } from '@/lib/use-relative-time';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { useBoundaryStore } from '@/state/boundary-store';
import { latestSuggestions, useAssistantStore } from '@/state/assistant-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { AssistantBubble, UserBubble } from './AssistantMessage';

/**
 * The design agent: one panel you talk to, that does the work in front of you.
 *
 * This replaces two panels that did not know about each other — a chat that handed you a list to
 * tick, and a control surface that could only play a scripted demonstration. The join is the whole
 * point of the feature: **say what you want, and watch the designer do it**, with Stop, Undo,
 * Compare and Replay as the net underneath.
 *
 * The transcript persists for the session and survives Undo. A conversation that cleared itself
 * each time the garden was wound back would throw away the only record of why the plan looks like
 * this — and the record is what makes the next request ("a bit more") mean anything.
 */

/**
 * The demonstration, worded as the request it stands for.
 *
 * It is a scripted run rather than a model call, which is what keeps it working on a machine with
 * no key — and what makes it the one thing somebody can press on arrival to find out what this
 * panel is for. Phrased as a sentence they could have typed, because that is what it is an example
 * of.
 */
const DEMO_REQUEST = 'Make the garden better for entertaining';

/** The demonstration is a development tool, not a feature. See `buildDemoRun`. */
function demoAllowed(): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('aiDemo');
}

export function DesignAgentPanel() {
  const messages = useAssistantStore((state) => state.messages);
  const phase = useAssistantStore((state) => state.phase);
  const available = useAssistantStore((state) => state.available);
  const probeAvailability = useAssistantStore((state) => state.probeAvailability);
  const send = useAssistantStore((state) => state.send);
  const reviewDesign = useAssistantStore((state) => state.reviewDesign);

  const runActive = useAiRunStore(selectRunActive);
  const blocked = useAiRunStore((state) => state.blocked);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const site = useBoundaryStore((state) => state.present);

  const busy = phase !== 'idle' || runActive;
  const [showDemo] = useState(demoAllowed);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  /*
   * Derived in a memo rather than inside the selector. `latestSuggestions` can build a fresh array,
   * and Zustand v5 compares snapshots by identity — a selector that never returns the same
   * reference twice spins `useSyncExternalStore` forever.
   */
  const suggestions = useMemo(() => latestSuggestions({ messages }), [messages]);

  /*
   * Only the newest reply carries the at-work block.
   *
   * There is one run engine and one current revision, so a block on every past message would be
   * five copies of one truth — and the older four would be narrating work that is not theirs. It
   * stays mounted after the run ends rather than unmounting with the "working" status, because the
   * run's final state (stopped, complete) is part of what that message has to report.
   */
  const latestReplyId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === 'assistant') return messages[i]!.id;
    }
    return null;
  }, [messages]);

  /* Asked once, so the no-key state can be shown before somebody types and waits for a failure. */
  useEffect(() => {
    void probeAvailability();
  }, [probeAvailability]);

  /* Follow the conversation as it grows, the way every chat does. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, phase]);

  const noKey = available === false;

  function submit(text: string) {
    if (text.trim() === '' || busy || noKey) return;
    setDraft('');
    void send(text);
  }

  /*
   * The demonstration, worded as a request rather than as a button called "Demo".
   *
   * It plays the scripted run rather than asking the model, which is what keeps it working on a
   * machine with no key — and what makes it useful as the one thing somebody can press on arrival
   * to find out what this panel is for.
   */
  function runDemo() {
    if (busy) return;
    const built = buildDemoRun(elements, site);
    if (!built.ok) {
      useAiRunStore.setState({ blocked: built.reason });
      return;
    }
    /*
     * Through the conversation, not round the side of it. It was a button that started a run on its
     * own, which left the user with a garden changing and nothing on screen saying why or offering
     * to stop it — and no record of it afterwards.
     */
    void useAssistantStore
      .getState()
      .playRun(
        built.run,
        DEMO_REQUEST,
        "I'll make room to eat outside, open up the route round the garden, and deepen the planting.",
      );
  }

  return (
    <section
      data-testid="design-agent-panel"
      /*
       * `lg:flex-1` only. Below that this column stacks under the canvas and the page scrolls; a
       * `flex-1 min-h-0` child there collapses and spills, which is the trap step 2 already named.
       */
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-garden-line bg-white p-4 shadow-sm lg:min-h-[10rem] lg:flex-1"
    >
      <h2 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-garden-muted uppercase">
        <Sparkles aria-hidden className="h-3.5 w-3.5 text-garden-ai" />
        Designer
      </h2>

      {/*
        The one announcement a screen reader gets.

        The transcript is a log and reads itself; the at-work block changes several times a second
        and is silenced. What is worth saying out loud is the phase and the outcome — which is what
        this carries, and nothing else.
      */}
      <p className="sr-only" role="status" data-testid="agent-status">
        {phase === 'thinking'
          ? 'The designer is reading the plan.'
          : phase === 'performing'
            ? 'The designer is changing the garden.'
            : phase === 'reviewing'
              ? 'The designer is reviewing its work.'
              : lastOutcomeText(messages)}
      </p>

      {/*
        Transcript and chips share one scroll. Two overflow regions meant the conversation and the
        next-request chips moved independently, so a long reply hid the chips in a second strip.
        The composer stays outside this, pinned, so Ask never scrolls off the card.
      */}
      {/* The way back to a redesign this session did not do. See `CarriedOverRevision`. */}
      <CarriedOverRevision />

      <div
        ref={logRef}
        className={`mt-3 min-h-0 overflow-y-auto pr-1 lg:flex-1 ${
          messages.length ? 'min-h-36 max-h-[26rem] lg:max-h-none' : ''
        }`}
      >
        <ul
          data-testid="assistant-log"
          role="log"
          aria-live="polite"
          aria-label="Design agent conversation"
          className="space-y-2"
        >
          {messages.length === 0 ? (
            <li data-testid="assistant-empty" className="text-xs leading-relaxed text-garden-muted">
              {noKey
                ? 'The designer needs an API key to read your requests. It can still review the design.'
                : 'Tell the designer what you want and watch it work. You keep every change, and can undo the lot in one go.'}
            </li>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <UserBubble key={message.id} message={message} />
            ) : (
              <AssistantBubble
                key={message.id}
                message={message}
                phase={phase}
                activity={message.id === latestReplyId}
              />
            ),
          )}
        </ul>

        {blocked && !busy ? (
          <p data-testid="ai-blocked" role="status" className="mt-2 text-xs text-garden-warn">
            {blocked}
          </p>
        ) : null}

        {/*
          Hidden while a run is going: offering a new request over a garden that is being rewritten
          invites a sentence written about a plan that will not exist by the time it is read.
        */}
        {!busy ? (
          <ul data-testid="assistant-suggestions" className="mt-2 flex flex-wrap gap-1.5">
            {/*
              Review is a chip rather than a second button, because it is a thing you ask for — and
              because it is the one request that works with no key at all: the reviewer is a scorer
              and a planner, with no model anywhere in it.
            */}
            <li>
              <Chip
                testId="ai-review"
                onClick={() => void reviewDesign()}
                disabled={elements.length === 0}
                icon={<ClipboardCheck aria-hidden className="h-3 w-3" />}
              >
                Review my design
              </Chip>
            </li>

            {showDemo ? (
              <li>
                <Chip testId="ai-demo-run" onClick={runDemo}>
                  Try: {DEMO_REQUEST.toLowerCase()}
                </Chip>
              </li>
            ) : null}

            {noKey
              ? null
              : suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <Chip onClick={() => submit(suggestion)}>{suggestion}</Chip>
                  </li>
                ))}
          </ul>
        ) : null}
      </div>

      <form
        className="mt-2 flex shrink-0 items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <input
          data-testid="assistant-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            noKey
              ? 'The designer needs an API key'
              : busy
                ? 'Watching…'
                : 'Ask for a change…'
          }
          aria-label="Ask the designer for a change"
          disabled={busy || noKey}
          className="min-w-0 flex-1 rounded-full border border-garden-line bg-white px-3 py-2 text-xs text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-ai focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          data-testid="assistant-send"
          disabled={busy || noKey || draft.trim() === ''}
          aria-label="Send"
          className="relative shrink-0 rounded-full bg-garden-ai p-2.5 text-white transition-colors before:absolute before:inset-0 before:-m-1 before:content-[''] hover:bg-garden-ai/90 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal aria-hidden className="h-3.5 w-3.5" />
        </button>
      </form>
    </section>
  );
}

/**
 * The way back to a redesign this session did not do.
 *
 * **This is the half of the persisted revision that was missing, and without it the record was
 * unreachable.** `layout.revision` is written on every sentence and autosaves within the second, so
 * a request the designer misread survives a reload — but the undo *stack* deliberately does not, and
 * the in-message controls read the run store, which is empty on a fresh page. So the data sat in the
 * document with nothing able to act on it, which is exactly the "tick the design ignores" defect
 * this codebase keeps catching.
 *
 * Three conditions, and each rules out a state where the offer would be wrong:
 *
 *  - **No session revision.** If this session ran the redesign, the message that produced it already
 *    carries Undo, Compare and Replay. A second Undo a few inches away, acting through a different
 *    mechanism, is two controls for one intention.
 *  - **The fingerprint still matches.** `undoRevision` refuses otherwise, so offering it would be a
 *    button that looks available and does nothing — the same fault the Replay gate exists to avoid.
 *    An edit since the redesign is also a real answer: they kept it and moved on.
 *  - **Something to go back to.** A null record is the ordinary state of a plan nobody has asked
 *    anything of.
 */
function CarriedOverRevision() {
  const record = usePlanEditorStore((state) => state.revision);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const sessionRevision = useAiRunStore((state) => state.revision);

  /* Cheap: a hash over a few dozen elements, and only while a record exists at all. */
  const untouched = useMemo(
    () => (record ? layoutFingerprint(elements) === record.afterFingerprint : false),
    [record, elements],
  );

  if (!record || sessionRevision || !untouched) return null;

  return <CarriedOverOffer record={record} />;
}

/**
 * Split out so `useRelativeTime`'s ticking hook is only mounted when there is something to time.
 *
 * Hooks cannot be called conditionally, and the alternative is a timer running on every editor
 * session for a block that is almost never on screen.
 */
function CarriedOverOffer({
  record,
}: {
  record: NonNullable<ReturnType<typeof usePlanEditorStore.getState>['revision']>;
}) {
  const when = useRelativeTime(record.createdAt);

  return (
    <div
      data-testid="ai-carried-revision"
      className="mt-3 shrink-0 rounded-lg border border-garden-line bg-garden-canvas p-2"
    >
      <p className="text-[11px] leading-relaxed text-garden-ink">
        {/*
          The request is named, because "undo the last redesign" is not a thing anybody remembers a
          day later. It is what they typed, so it is the one string that identifies which garden
          they would be going back to.
        */}
        The designer last worked on this plan {when}
        {record.request ? (
          <>
            , on “<span className="font-medium">{record.request}</span>”
          </>
        ) : null}
        .
      </p>
      <button
        type="button"
        data-testid="ai-undo-carried"
        onClick={() => usePlanEditorStore.getState().undoRevision()}
        className="relative mt-1.5 flex h-9 items-center gap-1.5 rounded-full border border-garden-line bg-white px-3 text-[11px] font-semibold text-garden-ink transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
      >
        <Undo2 aria-hidden className="h-3.5 w-3.5" />
        Put the garden back
      </button>
    </div>
  );
}

/** What the last finished request ended up doing, for the status region to announce. */
function lastOutcomeText(messages: ReturnType<typeof useAssistantStore.getState>['messages']): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'assistant') continue;
    if (message.status === 'failed') return message.text;
    if (message.outcome) return message.outcome.text;
  }
  return '';
}

function Chip({
  children,
  onClick,
  testId,
  disabled = false,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="relative flex h-9 items-center gap-1.5 rounded-full border border-garden-line bg-white px-3 text-[11px] font-medium text-garden-ink transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:border-garden-ai hover:bg-garden-sage disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
    >
      {icon}
      {children}
    </button>
  );
}
