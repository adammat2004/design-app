'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, SendHorizontal, Sparkles } from 'lucide-react';
import { latestSuggestions, useAssistantStore } from '@/state/assistant-store';
import { AssistantBubble, UserBubble } from './AssistantMessage';

/**
 * The AI Design Assistant.
 *
 * A chat shape — bubbles, a scrollback, an input at the bottom — built out of the wizard's own
 * cards, pills and tokens rather than a second visual language bolted on for "the AI part".
 *
 * The log persists for the session and survives Apply. A transcript that cleared itself each time
 * a change landed would throw away the only record of why the plan looks like this.
 */
export function AssistantPanel() {
  const messages = useAssistantStore((state) => state.messages);
  const pending = useAssistantStore((state) => state.pending);
  const send = useAssistantStore((state) => state.send);
  const error = useAssistantStore((state) => state.error);
  /*
   * Derived in a memo rather than inside the selector. `latestSuggestions` can build a fresh
   * array, and Zustand v5 compares snapshots by identity — a selector that never returns the
   * same reference twice spins `useSyncExternalStore` forever.
   */
  const suggestions = useMemo(() => latestSuggestions({ messages }), [messages]);

  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLUListElement>(null);

  // Follow the conversation as it grows, the way every chat does.
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
      data-testid="assistant-panel"
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-garden-ink">
        <Sparkles aria-hidden className="h-3.5 w-3.5 text-garden-green" />
        AI Design Assistant
        <span className="rounded-full bg-garden-sage px-1.5 py-px text-[9px] font-semibold text-garden-forest">
          Beta
        </span>
      </h2>

      <ul
        ref={logRef}
        data-testid="assistant-log"
        role="log"
        aria-live="polite"
        aria-label="Design assistant conversation"
        className="mt-3 min-h-[140px] flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <li
            data-testid="assistant-empty"
            className="text-[11px] leading-relaxed text-garden-muted"
          >
            Ask for a change in your own words — &ldquo;make the patio bigger&rdquo;, &ldquo;use
            gravel instead of paving&rdquo;. You will see exactly what would change before anything
            is applied.
          </li>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <UserBubble key={message.id} message={message} />
          ) : (
            <AssistantBubble key={message.id} message={message} />
          ),
        )}

        {pending ? (
          <li data-testid="assistant-pending" className="flex justify-start">
            <p className="flex items-center gap-1.5 rounded-xl rounded-bl-sm border border-garden-line bg-white px-2.5 py-1.5 text-[11px] text-garden-muted">
              <Sparkles aria-hidden className="h-3 w-3 animate-spin text-garden-green" />
              Working on it…
            </p>
          </li>
        ) : null}
      </ul>

      {error ? (
        <p
          data-testid="assistant-error"
          role="status"
          className="mt-2 flex items-start gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-900"
        >
          <CircleAlert aria-hidden className="mt-px h-2.5 w-2.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {suggestions.length > 0 && !pending ? (
        <ul data-testid="assistant-suggestions" className="mt-2 flex flex-wrap gap-1.5">
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
          data-testid="assistant-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask for a change…"
          aria-label="Ask the design assistant for a change"
          disabled={pending}
          className="min-w-0 flex-1 rounded-full border border-garden-line bg-white px-3 py-1.5 text-[11px] text-garden-ink placeholder:text-garden-muted focus-visible:border-garden-green focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          data-testid="assistant-send"
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
