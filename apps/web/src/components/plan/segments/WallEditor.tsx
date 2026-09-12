'use client';

import { House } from 'lucide-react';
import {
  houseWalls,
  WALL_KIND_LABELS,
  WallKindSchema,
  wallLength,
  type WallKind,
} from '@garden-studio/schema';
import { describeWall, wallLabel } from '@/lib/side-labels';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { WallElevationStrip } from '../WallElevationStrip';
import { ChipRow, EditorHeader, EditorSection } from './SegmentInspectorShell';
import { chipClass } from './SideEditor';

/**
 * One wall of the house, selected on the plan: what sort of wall it is, and the doors and windows
 * in it.
 *
 * The house twin of `SideEditor`. The elevation strip does the real work — a wall unrolled flat is
 * the only sane way to place a 900 mm door on a footprint a couple of centimetres across — and this
 * wraps it with the header and the classification that used to live in a `<select>` at the top of
 * the strip. A wall is picked by clicking it on the plan, which is what retired the row of
 * "Wall 1 (2)" chips that stood in for that.
 */
export function WallEditor({ wallId }: { wallId: string }) {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const setWallKind = useBoundaryStore((state) => state.setWallKind);

  const house = draft.house;
  if (!house) return null;

  const walls = houseWalls(house);
  const wall = walls.find((entry) => entry.id === wallId);
  if (!wall) return null;

  const length = wallLength(house, wall.id) ?? 0;

  return (
    <div data-testid="wall-editor" className="mt-3 space-y-4">
      <EditorHeader
        icon={<House aria-hidden className="h-4 w-4 text-garden-forest" />}
        title={`Wall ${walls.indexOf(wall) + 1}`}
        measure={formatLength(length, unit)}
        detail={wallLabel(describeWall(draft, wall.id))}
        testId="wall-heading"
      />

      {/*
        A party wall is the neighbour's house, and an attached garage takes only a garage door.
        Saying so is most of the input work saved: a mid-terrace has two walls worth asking about.
      */}
      <EditorSection title="This wall is">
        <ChipRow>
          {WallKindSchema.options.map((kind: WallKind) => (
            <button
              key={kind}
              type="button"
              data-testid={`wall-kind-${kind}`}
              aria-pressed={wall.kind === kind}
              onClick={() => setWallKind(wall.id, kind)}
              className={chipClass(wall.kind === kind)}
            >
              {WALL_KIND_LABELS[kind]}
            </button>
          ))}
        </ChipRow>
      </EditorSection>

      <EditorSection title="Doors and windows">
        <WallElevationStrip wallId={wall.id} />
      </EditorSection>
    </div>
  );
}
