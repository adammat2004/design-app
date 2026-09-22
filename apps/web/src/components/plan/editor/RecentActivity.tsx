'use client';

import { useMemo } from 'react';
import { useAiRunStore } from '@/state/ai-run-store';
import { useAssistantStore, type ChatMessage } from '@/state/assistant-store';
import { ReplyLine, RequestLine } from './AssistantMessage';
import { CarriedOverRevision, useCarriedOverRevision } from './CarriedOverRevision';
import { Caption } from './Pill';

/**
 * What was last done to the subject, as a record rather than a transcript.
 *
 * The inspector is about what can be done now, so the newest request and its outcome are the only
 * exchange shown in full — quoted line, outcome line, Compare and Undo. Everything before it is
 * folded under "Earlier requests", still in the same row style, because the record is what makes
 * "a bit more" mean anything and a conversation that cleared itself would throw it away.
 *
 * Nothing here is a bubble. Two speakers taking turns is the shape of a chat, and a chat under a
 * property sheet is the two-product feel this inspector exists to remove.
 */
export function RecentActivity() {
  const messages = useAssistantStore((state) => state.messages);
  const blocked = useAiRunStore((state) => state.blocked);
  const carried = useCarriedOverRevision();

  /* The newest request and whatever followed it; the rest is history. */
  const { latest, earlier } = useMemo(() => split(messages), [messages]);
  const earlierRequests = earlier.filter((message) => message.role === 'user').length;

  /*
   * Absent rather than empty. A "Recent change" heading over "nothing yet" is a section about the
   * tool rather than the garden, and the inspector's job before anything has been asked is to show
   * what can be done, not to leave room for a conversation that has not started.
   */
  if (messages.length === 0 && !blocked && !carried) return null;

  return (
    <section
      data-testid="assistant-log"
      role="log"
      aria-live="polite"
      aria-label="Recent requests to the designer"
      className="border-t border-garden-line px-4 py-3"
    >
      <Caption>Recent change</Caption>

      <div className="mt-1.5">
        <CarriedOverRevision />

        <ul className="space-y-1.5">
          {latest.map((message) =>
            message.role === 'user' ? (
              <RequestLine key={message.id} message={message} />
            ) : (
              <ReplyLine key={message.id} message={message} controls />
            ),
          )}
        </ul>

        {earlier.length > 0 ? (
          <details data-testid="assistant-history" className="group mt-2">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-garden-muted hover:text-garden-ink [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Earlier requests ({earlierRequests}) ▸</span>
              <span className="hidden group-open:inline">Earlier requests ({earlierRequests}) ▾</span>
            </summary>
            <ul className="mt-2 space-y-2 border-l border-garden-line pl-3">
              {earlier.map((message) =>
                message.role === 'user' ? (
                  <RequestLine key={message.id} message={message} />
                ) : (
                  <ReplyLine key={message.id} message={message} />
                ),
              )}
            </ul>
          </details>
        ) : null}

        {blocked ? (
          <p data-testid="ai-blocked" role="status" className="mt-2 text-[11px] text-garden-warn">
            {blocked}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** The last request and its reply, and everything before them. */
function split(messages: ChatMessage[]): { latest: ChatMessage[]; earlier: ChatMessage[] } {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') {
      start = i;
      break;
    }
  }
  if (start < 0) return { latest: messages, earlier: [] };
  return { latest: messages.slice(start), earlier: messages.slice(0, start) };
}
