'use client';

import { ArrowRight, Check, CircleAlert, Sparkles, X } from 'lucide-react';
import type {
  AssistantMessage as AssistantMessageModel,
  UserMessage,
} from '@/state/assistant-store';
import { useAssistantStore } from '@/state/assistant-store';

/**
 * One turn of the conversation.
 *
 * The assistant's replies are the interesting half: a plain-language summary, then the structured
 * diff it is proposing, one row per element with its old and new value. **Each row has its own
 * tick** — reviewing a suggestion means keeping the parts you want, and an all-or-nothing Apply
 * would make the review theatre.
 *
 * Applied blocks stay in the log rather than disappearing. They collapse to a compact record of
 * what went in and what did not, because "what did the assistant change" is a question the user
 * will ask again three edits later.
 */

export function UserBubble({ message }: { message: UserMessage }) {
  return (
    <li className="flex justify-end">
      <p
        data-testid={`chat-user-${message.id}`}
        className="max-w-[85%] rounded-xl rounded-br-sm bg-garden-sage px-2.5 py-1.5 text-[11px] leading-relaxed text-garden-forest"
      >
        {message.text}
      </p>
    </li>
  );
}

export function AssistantBubble({ message }: { message: AssistantMessageModel }) {
  const toggleChange = useAssistantStore((state) => state.toggleChange);
  const applyMessage = useAssistantStore((state) => state.applyMessage);

  const acceptedCount = message.changes.filter((change) => message.accepted[change.id]).length;

  return (
    <li className="flex justify-start">
      <div
        data-testid={`chat-assistant-${message.id}`}
        className="w-full max-w-[95%] rounded-xl rounded-bl-sm border border-garden-line bg-white p-2.5"
      >
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-garden-ink">
          <Sparkles aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-garden-green" />
          <span>{message.text}</span>
        </p>

        {message.changes.length > 0 ? (
          <div className="mt-2 rounded-lg border border-garden-line bg-garden-canvas p-2">
            <p className="text-[10px] font-semibold text-garden-ink">
              Proposed changes
              {message.applied ? (
                <span className="ml-1 font-normal text-garden-muted">
                  · {message.appliedIds.length} applied
                </span>
              ) : null}
            </p>

            <ul data-testid={`proposed-changes-${message.id}`} className="mt-1.5 space-y-1">
              {message.changes.map((change) => {
                const accepted = message.accepted[change.id];
                const applied = message.appliedIds.includes(change.id);
                const refusal = message.refused.find((entry) => entry.changeId === change.id);
                // Once applied, "rejected" means unticked or turned down by the store.
                const rejected = message.applied && !applied;

                return (
                  <li key={change.id}>
                    <label
                      data-testid={`change-${change.id}`}
                      data-accepted={accepted}
                      data-applied={applied}
                      className={[
                        'flex items-start gap-1.5 rounded-md px-1 py-0.5',
                        message.applied ? '' : 'cursor-pointer hover:bg-garden-sage/50',
                      ].join(' ')}
                    >
                      {message.applied ? (
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center"
                        >
                          {applied ? (
                            <Check className="h-3 w-3 text-garden-green" />
                          ) : (
                            <X className="h-3 w-3 text-garden-muted" />
                          )}
                        </span>
                      ) : (
                        <>
                          <input
                            type="checkbox"
                            data-testid={`accept-${change.id}`}
                            checked={accepted}
                            onChange={() => toggleChange(message.id, change.id)}
                            aria-label={`Accept: ${change.label} ${change.before} to ${change.after}`}
                            className="sr-only"
                          />
                          <span
                            aria-hidden
                            className={[
                              'mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded border',
                              accepted
                                ? 'border-garden-green bg-garden-green text-white'
                                : 'border-garden-line bg-white',
                            ].join(' ')}
                          >
                            {accepted ? <Check className="h-2 w-2" /> : null}
                          </span>
                        </>
                      )}

                      <span
                        className={[
                          'min-w-0 flex-1 text-[10px] leading-relaxed',
                          rejected ? 'text-garden-muted line-through' : 'text-garden-ink',
                        ].join(' ')}
                      >
                        <span className="font-medium">{change.label}</span>{' '}
                        <span className="text-garden-muted">{change.before}</span>
                        <ArrowRight
                          aria-hidden
                          className="mx-0.5 inline h-2.5 w-2.5 text-garden-muted"
                        />
                        <span>{change.after}</span>
                      </span>
                    </label>

                    {refusal ? (
                      <p className="flex items-start gap-1 pl-5 text-[9px] leading-relaxed text-red-700">
                        <CircleAlert aria-hidden className="mt-px h-2.5 w-2.5 shrink-0" />
                        {refusal.reason}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {message.applied ? null : (
              <>
                <button
                  type="button"
                  data-testid={`apply-${message.id}`}
                  disabled={acceptedCount === 0}
                  onClick={() => applyMessage(message.id)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full bg-garden-forest px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-garden-green focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check aria-hidden className="h-3 w-3" />
                  Apply{' '}
                  {acceptedCount === message.changes.length
                    ? 'changes'
                    : `${acceptedCount} change${acceptedCount === 1 ? '' : 's'}`}
                </button>
                <p className="mt-1 text-center text-[9px] text-garden-muted">
                  AI suggestions can be reviewed before applying.
                </p>
              </>
            )}
          </div>
        ) : null}

        {/*
          What was asked for and could not be placed.
          Below the diff rather than folded into the prose, because the planner wrote these
          sentences, not the model — they are measured facts about the garden, and the honest
          alternative to inventing a position for something that does not fit.
        */}
        {message.unplaceable.length > 0 ? (
          <ul data-testid={`unplaceable-${message.id}`} className="mt-2 space-y-1">
            {message.unplaceable.map((entry) => (
              <li
                key={entry.description}
                className="flex items-start gap-1 text-[10px] leading-relaxed text-garden-muted"
              >
                <CircleAlert aria-hidden className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-600" />
                <span>
                  <span className="font-medium text-garden-ink">{entry.description}</span> —{' '}
                  {entry.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
