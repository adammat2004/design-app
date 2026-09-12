'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, SendHorizontal, Sparkles, Undo2, X } from 'lucide-react';
import { useFeaturesStore } from '@/state/features-store';
import {
  latestGardenSuggestions,
  useGardenAssistantStore,
  type GardenAssistantMessage,
} from '@/state/garden-assistant-store';

/**
 * The Garden Assistant.
 *
 * Built from `editor/AssistantPanel.tsx`'s markup and tokens rather than a second visual language:
 * it is a helper for manipulating the plan, not the product, and it should not look like one.
 *
 * The difference is what a turn looks like afterwards. Step 5's panel renders a diff to review;
 * this one renders a *receipt* — what landed, what did not, and an Undo for the whole turn. The
 * canvas has already changed by the time the bubble appears, which is why the acknowledgement is in
 * the past tense and why Undo sits right next to it.
 */
export function GardenAssistantPanel({ onClose }: { onClose?: () => void }) {
  const messages = useGardenAssistantStore((state) => state.messages);
  const pending = useGardenAssistantStore((state) => state.pending);
  const error = useGardenAssistantStore((state) => state.error);
  const send = useGardenAssistantStore((state) => state.send);

  /*
   * In a memo rather than the selector. `latestGardenSuggestions` can build a fresh array, and
   * Zustand v5 compares snapshots by identity — a selector that never returns the same reference
   * twice spins `useSyncExternalStore` for ever.
   */
  const suggestions = useMemo(() => latestGardenSuggestions({ messages }), [messages]);

  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, pending]);

  function submit(text: string) {
    if (text.trim() === '' || pending) return;
    setDraft('');
    void send(text);
  }

  return (
    <section
      data-testid="garden-assistant-panel"
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        <h2 className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-garden-ink">
          <Sparkles aria-hidden className="h-3.5 w-3.5 text-garden-green" />
          Garden assistant
          <span className="rounded-full bg-garden-sage px-1.5 py-px text-[9px] font-semibold text-garden-forest">
            Beta
          </span>
        </h2>

        {onClose ? (
          <button
            type="button"
            data-testid="close-assistant"
            onClick={onClose}
            aria-label="Close the garden assistant"
            className="rounded-full p-1 text-garden-muted hover:bg-garden-sage hover:text-garden-ink focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <ul
        ref={logRef}
        data-testid="garden-assistant-log"
        role="log"
        aria-live="polite"
        aria-label="Garden assistant conversation"
        className={`mt-3 space-y-2 overflow-y-auto pr-1 ${messages.length ? 'max-h-80 min-h-36' : ''}`}
      >
        {messages.length === 0 ? (
          <li
            data-testid="garden-assistant-empty"
            className="text-[11px] leading-relaxed text-garden-muted"
          >
            Describe what is already in your garden — &ldquo;there is a shed in the back-left
            corner&rdquo;, &ldquo;a patio outside the back doors&rdquo;. Features appear on the plan
            straight away, and you can move them or undo.
          </li>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <li key={message.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-garden-forest px-2.5 py-1.5 text-[11px] text-white">
                {message.text}
              </p>
            </li>
          ) : (
            <Receipt key={message.id} message={message} />
          ),
        )}

        {pending ? (
          <li data-testid="garden-assistant-pending" className="flex justify-start">
            <p className="flex items-center gap-1.5 rounded-xl rounded-bl-sm border border-garden-line bg-white px-2.5 py-1.5 text-[11px] text-garden-muted">
              <Sparkles aria-hidden className="h-3 w-3 animate-spin text-garden-green" />
              Adding those…
            </p>
          </li>
        ) : null}
      </ul>

      {error ? (
        <p
          data-testid="garden-assistant-error"
          role="status"
          className="mt-2 flex items-start gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-900"
        >
          <CircleAlert aria-hidden className="mt-px h-2.5 w-2.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {suggestions.length > 0 && !pending ? (
        <ul data-testid="garden-assistant-suggestions" className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => submit(suggestion)}
                className="rounded-full border border-garden-line bg-white px-2 py-0.5 text-[10px] font-medium text-garden-ink transition-colors hover:border-garden-green hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <input
          data-testid="garden-assistant-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tell me what you have…"
          aria-label="Describe what is already in your garden"
          disabled={pending}
          className="min-w-0 flex-1 rounded-full border border-garden-line bg-white px-3 py-1.5 text-[11px] text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-green focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          data-testid="garden-assistant-send"
          disabled={pending || draft.trim() === ''}
          aria-label="Send"
          className="shrink-0 rounded-full bg-garden-forest p-2 text-white hover:bg-garden-green focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal aria-hidden className="h-3.5 w-3.5" />
        </button>
      </form>
    </section>
  );
}

/**
 * What one turn did, after it did it.
 *
 * Grouped by label and counted — "two trees", not two identical lines — because the user said "two
 * trees" and a receipt that does not match the sentence reads as a mistake.
 */
function Receipt({ message }: { message: GardenAssistantMessage }) {
  const undo = useFeaturesStore((state) => state.undo);
  const applied = message.changes.filter((change) => message.appliedIds.includes(change.id));

  const counts = new Map<string, number>();
  for (const change of applied) {
    counts.set(change.label, (counts.get(change.label) ?? 0) + 1);
  }

  return (
    <li className="flex justify-start">
      <div className="max-w-[92%] rounded-xl rounded-bl-sm border border-garden-line bg-white px-2.5 py-1.5">
        <p className="text-[11px] leading-relaxed text-garden-ink">{message.text}</p>

        {counts.size > 0 ? (
          <ul data-testid="garden-assistant-applied" className="mt-1.5 space-y-0.5">
            {[...counts].map(([label, count]) => (
              <li key={label} className="text-[11px] text-garden-muted">
                <span aria-hidden>· </span>
                {count > 1 ? `${count} × ${label}` : label}
              </li>
            ))}
          </ul>
        ) : null}

        {message.scope ? (
          <p className="mt-1.5 text-[11px] text-garden-muted">
            <span aria-hidden>· </span>
            Redesigning: {message.scope.zones.join(', ')}
          </p>
        ) : null}

        {/* The store's refusals, not the server's — these are what the live plan turned down. */}
        {message.refused.length > 0 ? (
          <ul data-testid="garden-assistant-refused" className="mt-1.5 space-y-0.5">
            {message.refused.map((refusal) => (
              <li key={refusal.changeId} className="text-[10px] text-amber-800">
                {refusal.reason}
              </li>
            ))}
          </ul>
        ) : null}

        {applied.length > 0 ? (
          <div className="mt-2 flex items-center gap-2">
            <p className="flex-1 text-[10px] text-garden-muted">Is that roughly right?</p>
            <button
              type="button"
              data-testid={`undo-${message.id}`}
              onClick={() => undo()}
              className="flex items-center gap-1 rounded-full border border-garden-line px-2 py-0.5 text-[10px] font-medium text-garden-ink hover:border-garden-green hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
            >
              <Undo2 aria-hidden className="h-2.5 w-2.5" />
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
