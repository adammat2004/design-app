'use client';

import { useMemo } from 'react';
import { Undo2 } from 'lucide-react';
import { layoutFingerprint } from '@/lib/concepts';
import { useRelativeTime } from '@/lib/use-relative-time';
import { useAiRunStore } from '@/state/ai-run-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { Pill } from './Pill';

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
export function CarriedOverRevision() {
  const record = useCarriedOverRevision();
  if (!record) return null;
  return <CarriedOverOffer record={record} />;
}

/** The record to offer, or null — so the section that holds the offer can know whether to exist. */
export function useCarriedOverRevision() {
  const record = usePlanEditorStore((state) => state.revision);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const sessionRevision = useAiRunStore((state) => state.revision);

  /* Cheap: a hash over a few dozen elements, and only while a record exists at all. */
  const untouched = useMemo(
    () => (record ? layoutFingerprint(elements) === record.afterFingerprint : false),
    [record, elements],
  );

  if (!record || sessionRevision || !untouched) return null;
  return record;
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
    <div data-testid="ai-carried-revision" className="mb-2">
      <p className="text-[11px] leading-relaxed text-garden-muted">
        {/*
          The request is named, because "undo the last redesign" is not a thing anybody remembers a
          day later. It is what they typed, so it is the one string that identifies which garden
          they would be going back to.
        */}
        The designer last worked on this plan {when}
        {record.request ? (
          <>
            , on “<span className="font-medium text-garden-ink">{record.request}</span>”
          </>
        ) : null}
        .
      </p>
      <div className="mt-1.5">
        <Pill
          testId="ai-undo-carried"
          onClick={() => usePlanEditorStore.getState().undoRevision()}
          icon={<Undo2 aria-hidden className="h-3.5 w-3.5" />}
        >
          Put the garden back
        </Pill>
      </div>
    </div>
  );
}
