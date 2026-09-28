'use client';

import { useState } from 'react';
import {
  describeStructureAlternative,
  describeStructureConflict,
  type SideNeighbour,
  type StructurePins,
  type StructureResizeResult,
  type Unit,
} from '@garden-studio/schema';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { Pill } from '../plan/editor/Pill';

export type BlockedResize = Extract<StructureResizeResult, { status: 'blocked' }>;

/**
 * What a structure's resize ran into, and what would work instead.
 *
 * Shown by both the plan's inspector and the 3D editor when a typed size is refused, because the
 * refusal is the same in both: nothing was changed, here is what is in the way, and here are
 * changes that have each been checked. Picking one applies it as one undo entry; keeping the
 * current size just closes the notice. Nothing here moves or trims anything the user did not pick.
 */
export function StructureResizeNotice({
  elementId,
  result,
  unit,
  onDone,
}: {
  elementId: string;
  result: BlockedResize;
  unit: Unit;
  onDone: () => void;
}) {
  const [stale, setStale] = useState(false);
  const sentences = [...new Set(result.conflicts.map(describeStructureConflict))];

  return (
    <div
      data-testid="structure-resize-blocked"
      role="alert"
      className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
    >
      <p className="text-[11px] leading-relaxed text-red-700">
        That size would not fit. {sentences.join(' ')}
      </p>
      {stale ? (
        <p className="text-[11px] text-red-700">The plan has changed since; try the size again.</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {result.alternatives.map((alternative, index) => (
          <Pill
            key={`${alternative.kind}-${index}`}
            testId={`structure-alternative-${alternative.kind}`}
            onClick={() => {
              if (
                usePlanEditorStore
                  .getState()
                  .applyStructureCandidate(elementId, alternative.element)
              )
                onDone();
              else setStale(true);
            }}
          >
            {describeStructureAlternative(alternative, unit)}
          </Pill>
        ))}
        <Pill testId="structure-alternative-keep" onClick={onDone}>
          Keep the current size
        </Pill>
      </div>
    </div>
  );
}

/**
 * Which edges a resize will hold still, in words: "Keeps its edge against the house." A resize that
 * moves the far side and not the near one is surprising unless it is said, and it is said here
 * rather than in a tooltip because it is the answer to "why did it grow that way?".
 */
export function describePins(pins: StructurePins): string {
  const names = [
    ...new Set(
      Object.values(pins)
        .filter(Boolean)
        .map((pin) => pinName(pin!)),
    ),
  ];
  if (names.length === 0) return 'Grows evenly about its centre.';
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Keeps its edge against ${list}.`;
}

function pinName(pin: SideNeighbour): string {
  switch (pin.kind) {
    case 'house':
      return 'the house';
    case 'boundary':
      return 'the boundary';
    case 'element':
      return pin.name
        ? `the ${pin.name.charAt(0).toLowerCase()}${pin.name.slice(1)}`
        : `the ${pin.category.replace('-', ' ')}`;
  }
}
