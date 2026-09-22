'use client';

import { useMemo, useState } from 'react';
import { ClipboardCheck, SendHorizontal } from 'lucide-react';
import { buildDemoRun } from '@/lib/ai-run/demo-script';
import { elementLabel } from '@/lib/concept-colours';
import { quickCommandsFor, type Subject } from '@/lib/smart-suggestions';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { useBoundaryStore } from '@/state/boundary-store';
import { latestSuggestions, useAssistantStore } from '@/state/assistant-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { Caption, Pill } from './Pill';

/**
 * The natural-language editing control for the current subject, pinned to the foot of the
 * inspector.
 *
 * Not a chat input. It sits under Material, Size and the suggestions as the third way of changing
 * the same thing, and it says so: "Ask for a change to Patio…". The chips above it are the shortest
 * form of the same idea — prewritten sentences about *it* — beside Review, which is the one request
 * that works with no key at all.
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

export function InspectorComposer({
  subject,
  busy,
  noKey,
}: {
  /** What the sentence will be about — the selection, or the garden. */
  subject: Subject;
  busy: boolean;
  noKey: boolean;
}) {
  const messages = useAssistantStore((state) => state.messages);
  const send = useAssistantStore((state) => state.send);
  const reviewDesign = useAssistantStore((state) => state.reviewDesign);
  const runActive = useAiRunStore(selectRunActive);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const site = useBoundaryStore((state) => state.present);

  const [showDemo] = useState(demoAllowed);
  const [draft, setDraft] = useState('');

  /*
   * Derived in a memo rather than inside the selector. `latestSuggestions` can build a fresh array,
   * and Zustand v5 compares snapshots by identity — a selector that never returns the same
   * reference twice spins `useSyncExternalStore` forever.
   */
  const chips = useMemo(() => {
    if (subject.kind === 'element') {
      return quickCommandsFor(subject).map((command) => ({ key: command.id, label: command.label, text: command.text }));
    }
    return latestSuggestions({ messages }).map((text) => ({ key: text, label: text, text }));
  }, [subject, messages]);

  const focusLabel = subject.kind === 'element' ? elementLabel(subject.element) : null;

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
    if (busy || runActive) return;
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
    <div className="shrink-0 border-t border-garden-line px-4 pt-3 pb-4">
      {/*
        Hidden while a run is going: offering a new request over a garden that is being rewritten
        invites a sentence written about a plan that will not exist by the time it is read.
      */}
      {!busy ? (
        <>
          <Caption>Ask the designer</Caption>
          {/* Said once, here, where the disabled composer would otherwise be the only clue. */}
          {noKey ? (
            <p data-testid="assistant-empty" className="mt-1 text-[11px] leading-relaxed text-garden-muted">
              The designer needs an API key to read your requests. It can still review the design.
            </p>
          ) : null}
          <ul
            data-testid="assistant-suggestions"
            className="mt-1.5 -mx-4 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          >
            {/*
              Review is a chip rather than a second button, because it is a thing you ask for — and
              because it is the one request that works with no key at all: the reviewer is a scorer
              and a planner, with no model anywhere in it.
            */}
            <li>
              <Pill
                testId="ai-review"
                onClick={() => void reviewDesign()}
                disabled={elements.length === 0}
                icon={<ClipboardCheck aria-hidden className="h-3 w-3" />}
              >
                Review my design
              </Pill>
            </li>

            {showDemo ? (
              <li>
                <Pill testId="ai-demo-run" onClick={runDemo}>
                  Try: {DEMO_REQUEST.toLowerCase()}
                </Pill>
              </li>
            ) : null}

            {noKey
              ? null
              : chips.map((chip) => (
                  <li key={chip.key}>
                    <Pill testId={`quick-command-${chip.key}`} onClick={() => submit(chip.text)}>
                      {chip.label}
                    </Pill>
                  </li>
                ))}
          </ul>
        </>
      ) : null}

      <form
        className={`flex items-center gap-1.5 ${busy ? '' : 'mt-1.5'}`}
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
                : focusLabel
                  ? `Ask for a change to ${focusLabel}…`
                  : 'Ask the designer about your garden…'
          }
          aria-label={
            focusLabel
              ? `Ask the designer for a change to ${focusLabel}`
              : 'Ask the designer about your garden'
          }
          disabled={busy || noKey}
          className="min-w-0 flex-1 rounded-md border border-garden-line bg-white px-3 py-2 text-xs text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-green focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          data-testid="assistant-send"
          disabled={busy || noKey || draft.trim() === ''}
          aria-label="Send"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-garden-forest text-white transition-colors before:absolute before:inset-0 before:-m-1 before:content-[''] hover:bg-garden-green focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal aria-hidden className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
