'use client';

import { Trash2 } from 'lucide-react';
import {
  canWallHold,
  houseWalls,
  isDoor,
  OPENING_HEIGHTS,
  OPENING_LABELS,
  openingSegment,
  STOREY_HEIGHT,
  SwingSchema,
  wallLength,
  type Opening,
  type OpeningType,
  type Swing,
} from '@garden-studio/schema';
import { formatLength } from '@/lib/units';
import { selectedOpeningId, useBoundaryStore } from '@/state/boundary-store';
import { SegmentTrack } from './segments/SegmentTrack';
import { chipClass } from './segments/SideEditor';
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
 *
 * Which wall it shows is a prop from `WallEditor`, and which opening is open for editing is the
 * store's selection — so a door clicked on the plan and a door clicked here are the same click.
 */

/** The types worth offering. Upstairs windows are recorded but not part of the common case. */
const OFFERED: OpeningType[] = ['patio-door', 'back-door', 'front-door', 'window', 'garage-door'];

const SWING_LABELS: Record<Swing, string> = {
  none: 'Slides',
  inward: 'Opens in',
  outward: 'Opens out',
};

export function WallElevationStrip({ wallId }: { wallId: string }) {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const openId = useBoundaryStore(selectedOpeningId);
  const select = useBoundaryStore((state) => state.select);
  const addOpening = useBoundaryStore((state) => state.addOpening);
  const moveOpening = useBoundaryStore((state) => state.moveOpening);
  const setOpeningWidth = useBoundaryStore((state) => state.setOpeningWidth);
  const setOpeningSill = useBoundaryStore((state) => state.setOpeningSill);
  const setOpeningSwing = useBoundaryStore((state) => state.setOpeningSwing);
  const moveOpeningLive = useBoundaryStore((state) => state.moveOpeningLive);
  const fitOpening = useBoundaryStore((state) => state.fitOpening);
  const removeOpening = useBoundaryStore((state) => state.removeOpening);
  const beginGesture = useBoundaryStore((state) => state.beginGesture);
  const endGesture = useBoundaryStore((state) => state.endGesture);

  const house = draft.house;
  if (!house) return null;

  const wall = houseWalls(house).find((entry) => entry.id === wallId) ?? null;
  if (!wall) return null;

  const length = wallLength(house, wall.id) ?? 0;
  const openings = house.openings.filter((opening) => opening.wallId === wall.id);
  const placed = openings.filter((opening) => openingSegment(house, opening) !== null);
  const unplaced = openings.filter((opening) => openingSegment(house, opening) === null);
  const selected = openings.find((opening) => opening.id === openId) ?? null;

  const offered = OFFERED.filter((type) => canWallHold(wall.kind, type));

  return (
    <div data-testid="wall-strip" className="space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {offered.map((type) => (
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
        {offered.length === 0 ? (
          <p data-testid="wall-holds-nothing" className="text-[11px] text-garden-muted">
            A party wall is your neighbour&rsquo;s house, so nothing opens onto the garden here.
          </p>
        ) : null}
      </div>

      {/* The wall itself, seen from the garden. Blocks at their true height against a storey. */}
      {offered.length > 0 ? (
        <SegmentTrack
          length={length}
          unit={unit}
          caption="This wall, seen from the garden"
          testId="wall-track"
          itemTestId={(id) => `opening-${id}`}
          items={placed.map((opening) => ({
            id: opening.id,
            offset: opening.offsetAlongEdge,
            width: opening.width,
            label: OPENING_LABELS[opening.type],
            selected: opening.id === openId,
            heightRatio: OPENING_HEIGHTS[opening.type] / STOREY_HEIGHT,
            bottomRatio: opening.sillHeight / STOREY_HEIGHT,
          }))}
          onSelect={(id) => select({ kind: 'opening', id })}
          onGestureStart={beginGesture}
          onMove={moveOpeningLive}
          onGestureEnd={endGesture}
        />
      ) : null}

      {/*
        An opening the wall has been resized out from under is kept in the document and drawn
        nowhere — the same rule a gate follows. Said here, with the two honest answers.
      */}
      {unplaced.length > 0 ? (
        <ul data-testid="unplaced-openings" className="space-y-1">
          {unplaced.map((opening) => (
            <li
              key={opening.id}
              data-testid={`unplaced-opening-${opening.id}`}
              className="flex items-center gap-2 rounded-md border border-garden-warn/40 bg-garden-warn/5 px-2 py-1 text-[10px] text-garden-ink"
            >
              <span className="min-w-0 flex-1 truncate">
                {`${OPENING_LABELS[opening.type]} · ${formatLength(opening.width, unit)} · off this wall`}
              </span>
              {opening.width <= length ? (
                <button
                  type="button"
                  data-testid={`fit-opening-${opening.id}`}
                  onClick={() => fitOpening(opening.id)}
                  className="rounded-md border border-garden-line bg-white px-2 py-0.5 font-medium text-garden-forest hover:border-garden-green"
                >
                  Fit to wall
                </button>
              ) : null}
              <button
                type="button"
                data-testid={`remove-unplaced-${opening.id}`}
                aria-label={`Remove this ${OPENING_LABELS[opening.type].toLowerCase()}`}
                onClick={() => removeOpening(opening.id)}
                className="rounded p-0.5 text-garden-muted hover:text-garden-warn"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

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
              onClick={() => removeOpening(selected.id)}
              className="rounded p-1 text-garden-muted hover:bg-garden-warn/10 hover:text-garden-warn"
            >
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>

          {/*
            Hinged or sliding is the one thing about a door the generator acts on that the plan
            cannot see: a hinged leaf sweeps an arc that has to stay clear, bifolds do not.
          */}
          {isDoor(selected) ? (
            <div className="flex flex-wrap gap-1">
              {SwingSchema.options.map((swing) => (
                <button
                  key={swing}
                  type="button"
                  data-testid={`opening-swing-${swing}`}
                  aria-pressed={selected.swing === swing}
                  onClick={() => setOpeningSwing(selected.id, swing)}
                  className={chipClass(selected.swing === swing)}
                >
                  {SWING_LABELS[swing]}
                </button>
              ))}
            </div>
          ) : null}

          {/*
            Typed as well as dragged: 900 mm is a standard door and typing it beats sliding to it.
          */}
          <Row label="Width">
            <LengthInput
              testId="opening-width"
              label="Width of this opening"
              metres={selected.width}
              unit={unit}
              readMetres={() => openingNow(selected.id)?.width ?? selected.width}
              onCommit={(width) => setOpeningWidth(selected.id, width)}
            />
          </Row>
          <Row label="From corner">
            <LengthInput
              testId="opening-offset"
              label="Distance from the start of the wall to the centre of this opening"
              metres={selected.offsetAlongEdge}
              unit={unit}
              readMetres={() =>
                openingNow(selected.id)?.offsetAlongEdge ?? selected.offsetAlongEdge
              }
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
              allowZero
              onCommit={(sill) => setOpeningSill(selected.id, sill)}
            />
          </Row>
        </div>
      ) : placed.length > 0 ? (
        <p className="text-[11px] text-garden-muted">
          Drag an opening along the wall, or click it to type its measurements.
        </p>
      ) : null}
    </div>
  );
}

function openingNow(openingId: string): Opening | undefined {
  return useBoundaryStore
    .getState()
    .present.house?.openings.find((opening) => opening.id === openingId);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-garden-muted">{label}</span>
      {children}
    </div>
  );
}
