'use client';

import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  canWallHold,
  houseWalls,
  OPENING_HEIGHTS,
  OPENING_LABELS,
  STOREY_HEIGHT,
  WALL_KIND_LABELS,
  wallLength,
  type Opening,
  type OpeningType,
  type WallKind,
} from '@garden-studio/schema';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { LengthInput } from './SideLengthsPanel';

/**
 * One wall, unrolled flat, with its doors and windows on it.
 *
 * Placing a 900 mm door on a house footprint at step-1 zoom is an unreasonable ask — the whole
 * building is a couple of centimetres across on screen. Unrolling the wall turns a hard 2D task
 * into an easy 1D one, and the mental model is one anybody can hold: *this wall, seen from the
 * garden*.
 *
 * Deliberately plain DOM rather than Konva. It is a ruler with draggable blocks on it, which React
 * handles better than a canvas, and it keeps the panel out of the `ssr: false` dance every canvas
 * in this app needs.
 *
 * **The horizontal axis is metres along the wall from its start corner**, which is exactly what
 * `offsetAlongEdge` stores — the number on the ruler and the number in the document are the same
 * number. The vertical axis is illustrative only: blocks are drawn at their true height against a
 * storey, but sill height is typed rather than dragged, because dragging it would imply a precision
 * the model does not carry.
 */

/** The types worth offering. Upstairs windows are recorded but not part of the common case. */
const OFFERED: OpeningType[] = ['patio-door', 'back-door', 'window', 'garage-door'];

/** Sliding snaps to this, in metres — fine enough to be exact, coarse enough to be steady. */
const SLIDE_STEP = 0.05;

/**
 * Where along the wall a pointer is, in metres. Pure so it can be tested without a layout, and
 * used by the drag itself so the test covers the arithmetic that actually runs.
 */
export function pointerOffset(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  wallLengthMetres: number,
): number {
  if (trackWidth <= 0) return 0;

  const metres = ((clientX - trackLeft) / trackWidth) * wallLengthMetres;
  return Math.round(metres / SLIDE_STEP) * SLIDE_STEP;
}

export function WallElevationStrip() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const selectedWallId = useBoundaryStore((state) => state.selectedWallId);
  const selectWall = useBoundaryStore((state) => state.selectWall);
  const setWallKind = useBoundaryStore((state) => state.setWallKind);
  const addOpening = useBoundaryStore((state) => state.addOpening);
  const moveOpening = useBoundaryStore((state) => state.moveOpening);
  const setOpeningWidth = useBoundaryStore((state) => state.setOpeningWidth);
  const setOpeningSill = useBoundaryStore((state) => state.setOpeningSill);
  const removeOpening = useBoundaryStore((state) => state.removeOpening);

  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const house = draft.house;
  if (!house) return null;

  const walls = houseWalls(house);
  const wall = walls.find((entry) => entry.id === selectedWallId) ?? null;

  if (!wall) {
    return (
      <Panel>
        <p data-testid="wall-strip-hint" className="text-[11px] leading-relaxed text-garden-muted">
          Pick a wall on the plan to add doors and windows. They are optional — without them the
          design still works, it just has less to go on.
        </p>
      </Panel>
    );
  }

  const length = wallLength(house, wall.id) ?? 0;
  const openings = house.openings.filter((opening) => opening.wallId === wall.id);
  const selected = openings.find((opening) => opening.id === selectedOpeningId) ?? null;

  function offsetFromPointer(clientX: number): number {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return 0;

    return pointerOffset(clientX, box.left, box.width, length);
  }

  /*
   * The move and up listeners go on the window rather than on the block, which is what keeps the
   * drag alive when the pointer runs off the end of the track — the common case, since sliding a
   * door to the corner of a wall means aiming past it. That also makes `setPointerCapture`
   * redundant, which is just as well: it is one of the DOM APIs jsdom does not implement.
   */
  function startSlide(event: React.PointerEvent, opening: Opening) {
    setSelectedOpeningId(opening.id);

    const onMove = (moveEvent: PointerEvent) =>
      moveOpening(opening.id, offsetFromPointer(moveEvent.clientX));

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const wallIndex = walls.indexOf(wall);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <p data-testid="wall-heading" className="text-[11px] font-medium text-garden-ink">
          {`Wall ${wallIndex + 1} · ${formatLength(length, unit)}`}
        </p>
        <select
          data-testid="wall-kind"
          aria-label="What sort of wall this is"
          value={wall.kind}
          onChange={(event) => setWallKind(wall.id, event.target.value as WallKind)}
          className="rounded-md border border-garden-line bg-white px-1.5 py-0.5 text-[11px] text-garden-ink"
        >
          {Object.entries(WALL_KIND_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/*
        A party wall is the neighbour's house, and an attached garage takes only a garage door.
        Saying so is most of the input work saved: a mid-terrace has two walls worth asking about.
      */}
      <div className="flex flex-wrap gap-1">
        {OFFERED.filter((type) => canWallHold(wall.kind, type)).map((type) => (
          <button
            key={type}
            type="button"
            data-testid={`add-opening-${type}`}
            onClick={() => addOpening(wall.id, type)}
            className="rounded-md border border-garden-line bg-white px-2 py-1 text-[10px] font-medium text-garden-muted hover:border-garden-green hover:text-garden-forest"
          >
            {`+ ${OPENING_LABELS[type]}`}
          </button>
        ))}
        {OFFERED.every((type) => !canWallHold(wall.kind, type)) ? (
          <p data-testid="wall-holds-nothing" className="text-[11px] text-garden-muted">
            A party wall is your neighbour&rsquo;s house, so nothing opens onto the garden here.
          </p>
        ) : null}
      </div>

      {/* The wall itself, seen from the garden. */}
      <div>
        <div
          ref={trackRef}
          data-testid="wall-track"
          className="relative h-24 overflow-hidden rounded-md border border-garden-line bg-garden-sage/25"
        >
          {openings.map((opening) => {
            const heightRatio = OPENING_HEIGHTS[opening.type] / STOREY_HEIGHT;
            const bottomRatio = opening.sillHeight / STOREY_HEIGHT;

            return (
              <button
                key={opening.id}
                type="button"
                data-testid={`opening-${opening.id}`}
                data-selected={opening.id === selectedOpeningId}
                aria-label={`${OPENING_LABELS[opening.type]} at ${formatLength(opening.offsetAlongEdge, unit)}`}
                onPointerDown={(event) => startSlide(event, opening)}
                style={{
                  left: `${((opening.offsetAlongEdge - opening.width / 2) / Math.max(length, 1e-6)) * 100}%`,
                  width: `${(opening.width / Math.max(length, 1e-6)) * 100}%`,
                  height: `${heightRatio * 100}%`,
                  bottom: `${bottomRatio * 100}%`,
                }}
                className={[
                  'absolute cursor-ew-resize touch-none rounded-sm border-2',
                  opening.id === selectedOpeningId
                    ? 'border-garden-forest bg-garden-green/40'
                    : 'border-garden-green bg-garden-green/20 hover:bg-garden-green/30',
                ].join(' ')}
              />
            );
          })}

          {/* The ground the storey stands on, so the blocks read as being at a height. */}
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-garden-muted" />
        </div>

        {/* The ruler, in the same metres as `offsetAlongEdge`. */}
        <div
          data-testid="wall-ruler"
          className="mt-1 flex justify-between text-[9px] text-garden-muted"
        >
          <span>0</span>
          <span>{formatLength(length / 2, unit)}</span>
          <span>{formatLength(length, unit)}</span>
        </div>

        <p className="mt-1 text-center text-[10px] text-garden-muted">
          This wall, seen from the garden
        </p>
      </div>

      {selected ? (
        <div data-testid="opening-inspector" className="space-y-2 border-t border-garden-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-garden-ink">
              {OPENING_LABELS[selected.type]}
            </p>
            <button
              type="button"
              data-testid="remove-opening"
              aria-label="Remove this opening"
              onClick={() => {
                removeOpening(selected.id);
                setSelectedOpeningId(null);
              }}
              className="rounded p-1 text-garden-muted hover:bg-garden-warn/10 hover:text-garden-warn"
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>

          {/*
            Typed as well as dragged: 900 mm is a standard door and typing it beats sliding to it.
          */}
          <Row label="Width">
            <LengthInput
              testId="opening-width"
              label="Width of this opening"
              metres={selected.width}
              unit={unit}
              onCommit={(width) => setOpeningWidth(selected.id, width)}
            />
          </Row>
          <Row label="From corner">
            <LengthInput
              testId="opening-offset"
              label="Distance from the start of the wall to the centre of this opening"
              metres={selected.offsetAlongEdge}
              unit={unit}
              onCommit={(offset) => moveOpening(selected.id, offset)}
            />
          </Row>
          {/* Editable, never draggable — see the note at the top of this file. */}
          <Row label="Sill height">
            <LengthInput
              testId="opening-sill"
              label="Height of this opening's sill above the floor"
              metres={selected.sillHeight}
              unit={unit}
              onCommit={(sill) => setOpeningSill(selected.id, sill)}
            />
          </Row>
        </div>
      ) : openings.length > 0 ? (
        <p className="text-[11px] text-garden-muted">
          Drag an opening along the wall, or click it to type its measurements.
        </p>
      ) : null}

      <button
        type="button"
        data-testid="close-wall-strip"
        onClick={() => {
          selectWall(null);
          setSelectedOpeningId(null);
        }}
        className="w-full rounded-lg border border-garden-line bg-white px-3 py-1.5 text-[11px] font-medium text-garden-ink hover:bg-garden-sage"
      >
        Done with this wall
      </button>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section data-testid="wall-strip" className="space-y-2.5 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">Doors and windows</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-garden-muted">{label}</span>
      {children}
    </div>
  );
}
