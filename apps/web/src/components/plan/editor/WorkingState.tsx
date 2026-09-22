'use client';

import { useAssistantStore } from '@/state/assistant-store';

/**
 * The inspector's body while the designer has the plan: the request being worked on, in the
 * subject's own inspector.
 *
 * The property controls are hidden rather than disabled — a form you cannot use is a form that
 * looks broken — and nothing here says "AI". The header above still names the subject; this block
 * says what is being done to it, and the stage list under it says how far along that is.
 */
export function WorkingState() {
  const messages = useAssistantStore((state) => state.messages);

  const request = [...messages].reverse().find((message) => message.role === 'user') ?? null;
  const reply = [...messages].reverse().find((message) => message.role === 'assistant') ?? null;

  return (
    <div data-testid="inspector-working-request" className="px-4 pt-3">
      {request ? (
        <p className="text-xs leading-relaxed font-medium text-garden-ink">“{request.text}”</p>
      ) : null}
      {reply?.text ? (
        <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">{reply.text}</p>
      ) : null}
    </div>
  );
}
