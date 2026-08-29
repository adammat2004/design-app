'use client';

import { Compass, DoorOpen } from 'lucide-react';
import {
  gardenDoors,
  houseWalls,
  OPENING_DEFAULTS,
  suggestedDoorWall,
  wallLength,
} from '@garden-studio/schema';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { WallElevationStrip } from './WallElevationStrip';

/**
 * The optional refinement that turns a footprint into a house with a way out of it.
 *
 * Deliberately **not** a new screen. The wizard was compressed hard already, and a mandatory step
 * about door positions would be a regression for the many users whose answer is "the patio doors
 * are in the middle of the back wall". It lives inside step 1's house tools, never gates Continue,
 * and every constraint that depends on an opening is simply skipped when there are none.
 */
export function OpeningsPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const selectedWallId = useBoundaryStore((state) => state.selectedWallId);
  const selectWall = useBoundaryStore((state) => state.selectWall);
  const addOpening = useBoundaryStore((state) => state.addOpening);
  const setOrientation = useBoundaryStore((state) => state.setOrientation);

  const house = draft.house;
  if (!house) return null;

  const doors = gardenDoors(house);
  const suggestion = house.openings.length === 0 ? suggestedDoorWall(house) : null;
  const suggestedLength = suggestion ? (wallLength(house, suggestion) ?? 0) : 0;
  const suggestionFits = suggestedLength >= OPENING_DEFAULTS['patio-door'].width;

  return (
    <section data-testid="openings-panel" className="space-y-3 border-t border-garden-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold text-garden-ink">Doors and windows</h2>
        <span data-testid="openings-count" className="text-[10px] text-garden-muted">
          {house.openings.length === 0
            ? 'None yet'
            : `${house.openings.length} placed · ${doors.length} onto the garden`}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-garden-muted">
        Where you step out decides where the terrace goes and where the paths run. Optional — but it
        is the single most useful thing you can tell us about the house.
      </p>

      {/*
        Offered rather than applied.

        The brief asked for this to be inserted silently and corrected. It is a chip instead, and the
        reason is that the whole value of an opening is that the generator *trusts* it: a wrong
        silent door has the design built confidently around a fiction the user never stated and
        cannot see they are being asked to check. One tap turns a guess into a statement.
      */}
      {suggestion && suggestionFits ? (
        <button
          type="button"
          data-testid="suggest-patio-door"
          onClick={() => {
            addOpening(suggestion, 'patio-door');
            selectWall(suggestion);
          }}
          className="flex w-full items-start gap-2 rounded-lg border border-garden-green bg-garden-sage/40 px-3 py-2 text-left hover:bg-garden-sage"
        >
          <DoorOpen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />
          <span>
            <span className="block text-[11px] font-semibold text-garden-forest">
              Add patio doors on the garden-facing wall
            </span>
            <span className="block text-[10px] text-garden-muted">
              {`Most houses have them here — ${formatLength(OPENING_DEFAULTS['patio-door'].width, unit)} wide, centred. You can move them after.`}
            </span>
          </span>
        </button>
      ) : null}

      {/* Which wall to work on, for anyone who would rather not click the plan. */}
      <div className="flex flex-wrap gap-1">
        {houseWalls(house).map((wall, index) => {
          const count = house.openings.filter((opening) => opening.wallId === wall.id).length;

          return (
            <button
              key={wall.id}
              type="button"
              data-testid={`pick-wall-${wall.id}`}
              aria-pressed={wall.id === selectedWallId}
              onClick={() => selectWall(wall.id === selectedWallId ? null : wall.id)}
              className={[
                'rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
                wall.id === selectedWallId
                  ? 'border-garden-green bg-garden-sage text-garden-forest'
                  : 'border-garden-line bg-white text-garden-muted hover:border-garden-green',
              ].join(' ')}
            >
              {`Wall ${index + 1}${count > 0 ? ` (${count})` : ''}`}
            </button>
          );
        })}
      </div>

      <WallElevationStrip />

      {/*
        North, at last as data rather than as a drawing. The compass on every canvas has always
        pointed up and nothing consulted it; shadows, sun-aware placement and "which windows face
        the light" all need this to exist before they can be built.
      */}
      <div className="flex items-center gap-2 border-t border-garden-line pt-3">
        <Compass aria-hidden className="h-4 w-4 shrink-0 text-garden-muted" />
        <label className="flex flex-1 items-center gap-2 text-[11px] text-garden-muted">
          North is
          <input
            type="number"
            step={5}
            min={0}
            max={359}
            data-testid="orientation"
            aria-label="Degrees clockwise from the top of the plan to true north"
            value={Math.round(draft.orientation)}
            onChange={(event) => setOrientation(Number(event.target.value))}
            className="w-16 rounded-md border border-garden-line bg-white px-2 py-1 text-sm text-garden-ink focus-visible:outline-none"
          />
          <span aria-hidden>° from up</span>
        </label>
      </div>
    </section>
  );
}
