'use client';

import { Check, CircleAlert, Columns2, Loader2, RotateCcw, Square, Undo2 } from 'lucide-react';
import type { ReviewPass } from '@/lib/ai-run/review-loop';
import { useAiRunStore } from '@/state/ai-run-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import {
  keyOf,
  useAssistantStore,
  type AssistantMessage as AssistantMessageModel,
  type UserMessage,
} from '@/state/assistant-store';
import { Pill } from './Pill';

/**
 * One request and what came of it, as two lines of a record rather than two bubbles of a chat.
 *
 * The inspector is about what can be done to the subject now; what was done to it a minute ago is
 * context, not conversation. So a request is a quoted line and the reply is a plain line under it
 * with a glyph for how it ended — no alignment, no speech shapes, no avatar. The reply is one
 * element for the whole life of a request: what the designer is about to do, then what it actually
 * did, then Compare and Undo against it.
 *
 * **Nothing here is written by the model except `text`.** The count, the refusals and the reviewer's
 * findings are all measured — see `composeOutcome` — which is what stops a reply claiming a change
 * the planner turned down.
 */

export function RequestLine({ message }: { message: UserMessage }) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <p
        data-testid={`chat-user-${message.id}`}
        className="min-w-0 text-xs leading-relaxed font-medium text-garden-ink"
      >
        “{message.text}”
      </p>
      {message.about ? <AboutTag message={message} about={message.about} /> : null}
    </li>
  );
}

/**
 * What a past request was about, and the way back to it.
 *
 * "Make it bigger" is unreadable a minute later, which is the cost of letting the canvas supply the
 * subject — so the transcript records what the subject was. The label is the one captured when the
 * sentence was sent, not one looked up now: the element may have been renamed since, and the
 * request was about what it was called at the time.
 *
 * Selecting it again is offered only where it still exists. A button that silently does nothing is
 * worse than a line of text, and this codebase has caught that fault twice already.
 */
function AboutTag({
  message,
  about,
}: {
  message: UserMessage;
  about: NonNullable<UserMessage['about']>;
}) {
  const present = usePlanEditorStore((state) =>
    state.present.elements.some((element) => element.id === about.id),
  );

  const className = 'max-w-full truncate text-[10px] text-garden-muted';

  if (!present) {
    return (
      <span data-testid={`chat-about-${message.id}`} className={className}>
        about {about.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={`chat-about-${message.id}`}
      onClick={() => usePlanEditorStore.getState().select(about.id)}
      className={`${className} rounded transition-colors hover:text-garden-ink hover:underline focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none`}
    >
      about {about.label}
    </button>
  );
}

export function ReplyLine({
  message,
  controls = false,
}: {
  message: AssistantMessageModel;
  /** Whether this is the newest reply, and therefore the one Compare, Undo and Replay act on. */
  controls?: boolean;
}) {
  const acceptOffer = useAssistantStore((state) => state.acceptOffer);
  const busy = useAssistantStore((state) => state.phase) !== 'idle';

  return (
    <li>
      <div data-testid={`chat-assistant-${message.id}`} data-status={message.status} className="min-w-0">
        {/*
          One line for how it ended. While the request is live this is the designer's intent; once
          there is a measured outcome that takes the line, and the intent drops to a muted note
          under it — what was set out to do is still worth a glance when what was done differs.
        */}
        <p
          className={`flex items-start gap-1.5 text-xs leading-relaxed ${
            message.status === 'failed' ? 'text-amber-900' : 'text-garden-ink'
          }`}
        >
          <StatusGlyph status={message.status} />
          {message.outcome ? (
            <span data-testid={`agent-outcome-${message.id}`} className="min-w-0">
              {message.outcome.text}
            </span>
          ) : (
            <span className="min-w-0">
              {message.text ||
                (message.status === 'thinking' ? 'Reading the plan…' : 'Working on it…')}
            </span>
          )}
        </p>

        {message.outcome && message.text && message.text !== message.outcome.text ? (
          <p className="mt-0.5 pl-5 text-[11px] leading-relaxed text-garden-muted">{message.text}</p>
        ) : null}

        {/*
          What was asked for and could not be done.

          The planner wrote these sentences, not the model — they are measured facts about the
          garden, and the honest alternative to inventing a position for something that does not fit.
        */}
        {message.outcome && message.outcome.refused.length > 0 ? (
          <ul data-testid={`agent-refused-${message.id}`} className="mt-1 space-y-0.5 pl-5">
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
            className="mt-1 pl-5"
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
              <ul className="space-y-1">
                {/* Keyed on the fault *and* what it was about: two pinched paths are two faults. */}
                {message.outcome.review.passes.map((pass) => (
                  <li
                    key={`${pass.issue.code}:${pass.issue.subjects.join(',')}`}
                    className="text-[11px]"
                  >
                    <span className="block text-garden-ink">{pass.issue.message}</span>
                    <span className={pass.kept ? 'text-garden-green' : 'text-garden-muted'}>
                      {reviewLine(pass)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {/* Compare, Undo and Replay, against the redesign this message is about. */}
        {controls && message.outcome && message.outcome.changed > 0 ? <RunControls /> : null}

        {/*
          Faults the reviewer found and left alone, because they are not what was asked about.

          The answer to "it saw something wrong and said nothing?" — and the reason the review pass
          can be scoped at all without the user feeling the tool went quiet on them.
        */}
        {message.offers.length > 0 ? (
          <ul data-testid={`agent-offers-${message.id}`} className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
            {message.offers.map((offer) => (
              <li key={keyOf(offer)}>
                <Pill
                  testId={`agent-offer-${keyOf(offer)}`}
                  disabled={busy}
                  onClick={() => void acceptOffer(message.id, keyOf(offer))}
                >
                  {offer.issue.message}
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** How the request ended, at a glance. */
function StatusGlyph({ status }: { status: AssistantMessageModel['status'] }) {
  const base = 'mt-0.5 h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'done':
      return <Check aria-hidden className={`${base} text-garden-green`} strokeWidth={2.5} />;
    case 'failed':
      return <CircleAlert aria-hidden className={`${base} text-amber-600`} />;
    case 'stopped':
      return <Square aria-hidden className={`${base} p-0.5 text-garden-muted`} />;
    default:
      return <Loader2 aria-hidden className={`${base} animate-spin text-garden-ai`} />;
  }
}

/**
 * Compare, Undo and Replay.
 *
 * Read off `ai-run-store` rather than off the message, because they act on the *plan* and the plan
 * has one current revision. Rendered under the newest reply, which is what makes "undo that" mean
 * the thing the user is looking at.
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
    <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
      <Pill
        testId="ai-compare"
        onClick={() => useAiRunStore.getState().toggleCompare()}
        icon={<Columns2 aria-hidden className="h-3.5 w-3.5" />}
      >
        {comparing ? 'Show the changes' : 'Compare before'}
      </Pill>
      <Pill
        testId="ai-undo"
        onClick={() => useAiRunStore.getState().undoRun()}
        disabled={!undoable}
        hint={undoable ? undefined : 'You have edited the plan since. Use Undo in the toolbar.'}
        icon={<Undo2 aria-hidden className="h-3.5 w-3.5" />}
      >
        Undo changes
      </Pill>
      <Pill
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
      >
        Replay
      </Pill>
    </div>
  );
}

/**
 * What the reviewer says about one pass.
 *
 * Three outcomes rather than two, and the third is the one the loop could not report before the
 * search moved to the server: it now measures several corrections against the plan and can say that
 * none of them helped **without performing one**. "Tried, and put back" was the only thing it could
 * say when the only way to find out was to do it.
 */
function reviewLine(pass: ReviewPass): string {
  if (pass.kept) {
    return `Kept — the design scores ${pass.after.toFixed(2)}, up from ${pass.before.toFixed(2)}.`;
  }
  if (pass.played) return 'Tried, and put back: it did not measurably improve the design.';

  const tested =
    pass.considered > 1 ? `Tested ${pass.considered} corrections` : 'Looked for a correction';
  return `${tested}: ${lowerFirst(pass.reason ?? 'none of them makes the design better.')}`;
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
