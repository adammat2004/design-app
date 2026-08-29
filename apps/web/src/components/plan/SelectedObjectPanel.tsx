'use client';

import { House, MousePointer2, RotateCcw } from 'lucide-react';
import { vertexLabel } from '@/lib/boundary-geometry';
import { houseArea, houseSize } from '@/lib/house';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { LengthInput } from './SideLengthsPanel';

/**
 * Two-way bound properties for whatever is selected. Dragging on the canvas writes here;
 * typing here moves the shape — the same pattern the side lengths use.
 */
export function SelectedObjectPanel() {
  const selection = useBoundaryStore((state) => state.selection);
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const setHouseSize = useBoundaryStore((state) => state.setHouseSize);
  const setHouseRotation = useBoundaryStore((state) => state.setHouseRotation);

  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Selected object</h2>

      {selection?.kind === 'house' && draft.house ? (
        <div data-testid="selected-house" className="mt-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <House aria-hidden className="h-4 w-4 text-garden-forest" />
            </span>
            <p className="text-xs font-semibold text-garden-ink">House footprint</p>
          </div>

          <Field label="Width">
            <LengthInput
              testId="house-width"
              label="House width"
              metres={houseSize(draft.house).width}
              unit={unit}
              onCommit={(width) => setHouseSize({ width })}
            />
          </Field>

          <Field label="Depth">
            <LengthInput
              testId="house-depth"
              label="House depth"
              metres={houseSize(draft.house).depth}
              unit={unit}
              onCommit={(depth) => setHouseSize({ depth })}
            />
          </Field>

          <Field label="Area">
            {/* Derived from the footprint, so there is nothing here to type into. */}
            <span
              data-testid="house-area"
              className="block py-1 text-right text-sm font-medium text-garden-ink"
            >
              {formatArea(houseArea(draft.house), unit)}
            </span>
          </Field>

          <Field label="Rotation">
            <RotationField degrees={draft.house.rotation} onChange={setHouseRotation} />
          </Field>
        </div>
      ) : selection?.kind === 'vertex' ? (
        <VertexFields id={selection.id} />
      ) : (
        <p
          data-testid="selected-none"
          className="mt-3 text-[11px] leading-relaxed text-garden-muted"
        >
          <MousePointer2 aria-hidden className="mr-1 inline h-3.5 w-3.5" />
          Select a corner or the house to edit its measurements.
        </p>
      )}
    </section>
  );
}

function VertexFields({ id }: { id: string }) {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const nudgeVertex = useBoundaryStore((state) => state.nudgeVertex);

  const index = draft.vertices.findIndex((vertex) => vertex.id === id);
  const vertex = draft.vertices[index];
  if (!vertex) return null;

  return (
    <div data-testid="selected-vertex" className="mt-3 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-garden-green bg-white text-xs font-semibold text-garden-forest">
          {vertexLabel(index)}
        </span>
        <p className="text-xs font-semibold text-garden-ink">Boundary corner</p>
      </div>

      {/* Absolute coordinates, so nudging is expressed as a move to a new position. */}
      <Field label="X">
        <LengthInput
          testId="vertex-x"
          label="Corner x position"
          metres={vertex.x}
          unit={unit}
          allowNegative
          onCommit={(x) => nudgeVertex(id, x - vertex.x, 0)}
        />
      </Field>
      <Field label="Y">
        <LengthInput
          testId="vertex-y"
          label="Corner y position"
          metres={vertex.y}
          unit={unit}
          allowNegative
          onCommit={(y) => nudgeVertex(id, 0, y - vertex.y)}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-garden-muted">{label}</span>
      <span className="w-28">{children}</span>
    </label>
  );
}

/** The angles anyone actually uses, in 45 degree steps. */
const ROTATION_PRESETS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A dropdown rather than a number field: houses sit square to something almost always, and
 * the free-entry version invited fiddling with angles nobody wants. A rotation arrived at by
 * dragging the canvas handle is kept as an extra option so the select never lies.
 */
function RotationField({
  degrees,
  onChange,
}: {
  degrees: number;
  onChange: (degrees: number) => void;
}) {
  const rounded = Math.round(degrees);
  const options = ROTATION_PRESETS.includes(rounded)
    ? ROTATION_PRESETS
    : [...ROTATION_PRESETS, rounded].sort((a, b) => a - b);

  return (
    <span className="flex items-center gap-1">
      <select
        data-testid="house-rotation"
        aria-label="House rotation in degrees"
        value={rounded}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 rounded-md border border-garden-line bg-white px-2 py-1 text-sm text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}°
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="reset-rotation"
        aria-label="Reset rotation to 0 degrees"
        title="Reset rotation"
        disabled={rounded === 0}
        onClick={() => onChange(0)}
        className="shrink-0 rounded-md p-1.5 text-garden-muted hover:bg-garden-sage hover:text-garden-forest focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
      >
        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
