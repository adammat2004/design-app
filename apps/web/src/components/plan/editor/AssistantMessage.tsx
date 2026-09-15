'use client';

import { CircleAlert, Columns2, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { useAiRunStore } from '@/state/ai-run-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import {
  keyOf,
  useAssistantStore,
  type AgentPhase,
  type AssistantMessage as AssistantMessageModel,
  type UserMessage,
} from '@/state/assistant-store';
import { AgentActivity } from './AgentActivity';

/**
 * One turn of the conversation.
 *
 * The designer's reply is one bubble for the whole life of a request: what it is about to do, the
 * work happening underneath it, then what it actually did. It used to be a reply plus a diff with a
 * tick against each line and an Apply button — a review step that existed because nothing could be
 * watched. Now the change *is* watched, and the review step moved to where it belongs: after, with
 * Compare and Undo.
 *
 * **Nothing here is written by the model except `text`.** The count, the refusals and the reviewer's
 * findings are all measured — see `composeOutcome` — which is what stops a reply claiming a change
 * the planner turned down.
 */

export function UserBubble({ message }: { message: UserMessage }) {
  return (
    <li className="flex justify-end">
      <p
        data-testid={`chat-user-${message.id}`}
        className="max-w-[85%] rounded-xl rounded-br-sm bg-garden-sage px-2.5 py-1.5 text-xs leading-relaxed text-garden-forest"
      >
        {message.text}
      </p>
    </li>
  );
}

export function AssistantBubble({
  message,
  phase,
  activity = false,
}: {
  message: AssistantMessageModel;
  /** The conversation's phase, so the live message knows it is the live one. */
  phase: AgentPhase;
  /** Whether this is the newest reply, and therefore the one that carries the at-work block. */
  activity?: boolean;
}) {
  const acceptOffer = useAssistantStore((state) => state.acceptOffer);
  const busy = useAssistantStore((state) => state.phase) !== 'idle';

  return (
    <li className="flex justify-start">
      <div
        data-testid={`chat-assistant-${message.id}`}
        data-status={message.status}
        className="w-full rounded-xl rounded-bl-sm border border-garden-line bg-white p-2.5"
      >
        <p
          className={`flex items-start gap-1.5 text-xs leading-relaxed ${
            message.status === 'failed' ? 'text-amber-900' : 'text-garden-ink'
          }`}
        >
          {message.status === 'failed' ? (
            <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          ) : (
            <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-garden-ai" />
          )}
          <span>
            {message.text ||
              (message.status === 'thinking' ? 'Reading the plan…' : 'Working on it…')}
          </span>
        </p>

        {/* The work itself, sticky to the bottom of the transcript while it is happening. */}
        {activity ? <AgentActivity phase={phase} /> : null}

        {message.outcome ? (
          <p
            data-testid={`agent-outcome-${message.id}`}
            className="mt-2 text-xs leading-relaxed text-garden-ink"
          >
            {message.outcome.text}
          </p>
        ) : null}

        {/*
          What was asked for and could not be done.

          The planner wrote these sentences, not the model — they are measured facts about the
          garden, and the honest alternative to inventing a position for something that does not fit.
        */}
        {message.outcome && message.outcome.refused.length > 0 ? (
          <ul data-testid={`agent-refused-${message.id}`} className="mt-1.5 space-y-1">
            {message.outcome.refused.map((entry, index) => (
              <li
                key={`${entry.label}-${index}`}
                className="flex items-start gap-1 text-[11px] leading-relaxed text-garden-muted"
              >
                <CircleAlert aria-hidden className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-600" />
                <span>
                  <span className="font-medium text-garden-ink">{entry.label}</span> —{' '}
                  {entry.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          What the reviewer found, kept or not.

          A pass that was played and wound back is still reported: the user watched it happen, and a
          message that only listed what survived would be pretending the rest never occurred. The
          scores are the evidence for "kept", so they are shown rather than summarised away.
        */}
        {message.outcome?.review ? (
          <div
            className="mt-2 border-t border-garden-line pt-2"
            data-testid="ai-review-outcome"
            data-verdict={message.outcome.review.verdict}
          >
            {message.outcome.review.passes.length === 0 ? (
              <p className="text-[11px] text-garden-muted">
                {message.outcome.review.verdict === 'nothing-to-fix'
                  ? 'The reviewer found nothing it could improve.'
                  : 'The reviewer stopped before it finished.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {/* Keyed on the fault *and* what it was about: two pinched paths are two faults. */}
                {message.outcome.review.passes.map((pass) => (
                  <li
                    key={`${pass.issue.code}:${pass.issue.subjects.join(',')}`}
                    className="text-[11px]"
                  >
                    <span className="block text-garden-ink">{pass.issue.message}</span>
                    <span className={pass.kept ? 'text-garden-green' : 'text-garden-muted'}>
                      {pass.kept
                        ? `Kept — the design scores ${pass.after.toFixed(2)}, up from ${pass.before.toFixed(2)}.`
                        : 'Tried, and put back: it did not measurably improve the design.'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {/* Compare, Undo and Replay, against the redesign this message is about. */}
        {message.outcome && message.outcome.changed > 0 ? <RunControls /> : null}

        {/*
          Faults the reviewer found and left alone, because they are not what was asked about.

          The answer to "it saw something wrong and said nothing?" — and the reason the review pass
          can be scoped at all without the user feeling the tool went quiet on them.
        */}
        {message.offers.length > 0 ? (
          <ul data-testid={`agent-offers-${message.id}`} className="mt-2 flex flex-wrap gap-1.5">
            {message.offers.map((offer) => (
              <li key={keyOf(offer)}>
                <button
                  type="button"
                  data-testid={`agent-offer-${keyOf(offer)}`}
                  disabled={busy}
                  onClick={() => void acceptOffer(message.id, keyOf(offer))}
                  className="relative h-9 rounded-full border border-garden-line bg-white px-3 text-[11px] font-medium text-garden-ink transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:border-garden-ai hover:bg-garden-sage disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
                >
                  {offer.issue.message}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Compare, Undo and Replay.
 *
 * Read off `ai-run-store` rather than off the message, because they act on the *plan* and the plan
 * has one current revision. Rendered inside the message that produced it, which is what makes
 * "undo that" mean the thing the user is looking at — but the moment they ask for something else,
 * the buttons on the older message are correctly disabled, because the garden has moved on.
 */
function RunControls() {
  const revision = useAiRunStore((state) => state.revision);
  const comparing = useAiRunStore((state) => state.compare === 'before');
  const elements = usePlanEditorStore((state) => state.present.elements);

  /** Undo only while the redesign is still exactly what is on the plan. */
  const undoable = revision !== null && revision.result === elements;

  /*
   * Replay needs one thing more than Undo: a redesign that ran to the end.
   *
   * A stopped run leaves a revision so Undo and Compare work, but its timeline is the whole run
   * including the part the user stopped — `replay()` refuses it. Leaving the button live would be a
   * control that looks available and does nothing, which is the worst of the three states.
   */
  const replayable = revision?.complete === true && revision.result === elements;

  if (!revision) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <RunButton
        testId="ai-compare"
        onClick={() => useAiRunStore.getState().toggleCompare()}
        icon={<Columns2 aria-hidden className="h-3.5 w-3.5" />}
        label={comparing ? 'Show the changes' : 'Compare before'}
      />
      <RunButton
        testId="ai-undo"
        onClick={() => useAiRunStore.getState().undoRun()}
        disabled={!undoable}
        hint={undoable ? undefined : 'You have edited the plan since. Use Undo in the toolbar.'}
        icon={<Undo2 aria-hidden className="h-3.5 w-3.5" />}
        label="Undo changes"
      />
      <RunButton
        testId="ai-replay"
        onClick={() => useAiRunStore.getState().replay()}
        disabled={!replayable}
        hint={
          replayable
            ? undefined
            : undoable
              ? 'This redesign was stopped part way, so there is no whole run to replay.'
              : 'The plan has changed since these were made.'
        }
        icon={<RotateCcw aria-hidden className="h-3.5 w-3.5" />}
        label="Replay"
      />
    </div>
  );
}

function RunButton({
  testId,
  onClick,
  icon,
  label,
  disabled = false,
  hint,
}: {
  testId: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="relative flex h-9 items-center gap-1.5 rounded-full border border-garden-line bg-white px-3 text-[11px] font-semibold text-garden-ink transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:bg-garden-sage disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
    >
      {icon}
      {label}
    </button>
  );
}
