'use client';

import { House, PenLine, Shapes, Square } from 'lucide-react';
import {
  DEFAULT_LSHAPE_PLOT,
  DEFAULT_RECTANGLE_PLOT,
  isUsableLShape,
  isUsableRectangle,
  lShapePlotOutline,
  matchLShapePlot,
  matchRectanglePlot,
  rectanglePlotOutline,
  type LShapePlot,
  type Point,
  type RectanglePlot,
} from '@garden-studio/schema';
import { boundingBox, draftPolygon } from '@/lib/boundary-geometry';
import { useBoundaryStore } from '@/state/boundary-store';
import { LengthInput } from './SideLengthsPanel';

/**
 * How the plot starts, and how its dimensions are edited afterwards.
 *
 * Step 1 used to open on a blank grid with corner-by-corner drawing as the only path. That gesture
 * carries no scale at all, which is how a 113 x 74.5 m "garden" was drawn and accepted: the user
 * was originating a measurement from nothing. Opening on a real, correctly-scaled rectangle turns
 * the task into adjusting a default, and makes freehand the escape hatch for irregular plots rather
 * than the mandatory route.
 *
 * **The shape is derived from the outline, never stored.** Whether the dimension fields appear is
 * decided by `matchRectanglePlot` / `matchLShapePlot` reading the actual corners, for the same
 * reason zones are recomputed rather than persisted: a remembered "this is a rectangle" flag goes
 * stale the moment a corner is dragged, and then the width field is editing a shape that is not
 * there any more.
 *
 * That has a visible consequence worth understanding. These fields and `SideLengthsPanel` use
 * **different** editing models — width moves two corners because a rectangle has to stay a
 * rectangle, where a side length moves one because a free-form outline has no such rule. Editing a
 * side of a rectangle therefore makes these fields disappear, which is the honest report: it is a
 * quadrilateral now.
 */
export function PlotShapePanel() {
  const draft = useBoundaryStore((state) => state.present);
  const setPlotOutline = useBoundaryStore((state) => state.setPlotOutline);
  const setBoundaryTool = useBoundaryStore((state) => state.setBoundaryTool);
  const setMode = useBoundaryStore((state) => state.setMode);
  const unit = useBoundaryStore((state) => state.unit);

  const polygon = draftPolygon(draft);

  if (polygon.length === 0) {
    return (
      <ShapePicker
        onRectangle={() => setPlotOutline(rectanglePlotOutline(DEFAULT_RECTANGLE_PLOT))}
        onLShape={() => setPlotOutline(lShapePlotOutline(DEFAULT_LSHAPE_PLOT))}
        onCustom={() => setBoundaryTool('draw')}
      />
    );
  }

  // Where the outline currently sits, so re-applying a dimension does not move the plot.
  const box = boundingBox(polygon);
  const origin: Point = { x: box.minX, y: box.minY };

  const rectangle = matchRectanglePlot(polygon);
  const lshape = rectangle ? null : matchLShapePlot(polygon);

  if (!rectangle && !lshape) return null;

  function applyRectangle(spec: RectanglePlot) {
    if (isUsableRectangle(spec)) setPlotOutline(rectanglePlotOutline(spec, origin));
  }

  function applyLShape(spec: LShapePlot) {
    if (isUsableLShape(spec)) setPlotOutline(lShapePlotOutline(spec, origin));
  }

  return (
    <section
      data-testid="plot-shape"
      data-shape={rectangle ? 'rectangle' : 'lshape'}
      className="space-y-3 border-t border-garden-line pt-4"
    >
      <h2 className="text-xs font-semibold text-garden-ink">
        {rectangle ? 'Plot size' : 'Plot size (L-shape)'}
      </h2>

      <div className="space-y-2">
        {rectangle ? (
          <>
            <Field
              testId="plot-width"
              label="Width"
              metres={rectangle.width}
              unit={unit}
              onCommit={(width) => applyRectangle({ ...rectangle, width })}
            />
            <Field
              testId="plot-depth"
              label="Depth"
              metres={rectangle.depth}
              unit={unit}
              onCommit={(depth) => applyRectangle({ ...rectangle, depth })}
            />
          </>
        ) : lshape ? (
          <>
            <Field
              testId="plot-width"
              label="Width"
              metres={lshape.width}
              unit={unit}
              onCommit={(width) => applyLShape({ ...lshape, width })}
            />
            <Field
              testId="plot-depth"
              label="Depth"
              metres={lshape.depth}
              unit={unit}
              onCommit={(depth) => applyLShape({ ...lshape, depth })}
            />
            <Field
              testId="plot-return-width"
              label="Return width"
              metres={lshape.returnWidth}
              unit={unit}
              onCommit={(returnWidth) => applyLShape({ ...lshape, returnWidth })}
            />
            <Field
              testId="plot-return-depth"
              label="Return depth"
              metres={lshape.returnDepth}
              unit={unit}
              onCommit={(returnDepth) => applyLShape({ ...lshape, returnDepth })}
            />
          </>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-garden-muted">
        Measure the boundary itself, not the lawn inside it. Dragging a corner on the plan turns
        this into a free-form outline.
      </p>

      {/*
        The preset does not advance to house placement the way closing a hand-drawn outline does —
        the user has only just been handed a default and needs a chance to type their real
        dimensions first. So the next step is offered rather than taken.
      */}
      <button
        type="button"
        data-testid="plot-shape-continue"
        onClick={() => setMode('house')}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-garden-line bg-white px-3 py-2 text-xs font-medium text-garden-ink hover:border-garden-green hover:text-garden-forest"
      >
        <House aria-hidden className="h-4 w-4" />
        Place the house
      </button>
    </section>
  );
}

function ShapePicker({
  onRectangle,
  onLShape,
  onCustom,
}: {
  onRectangle: () => void;
  onLShape: () => void;
  onCustom: () => void;
}) {
  return (
    <section data-testid="plot-shape-picker" className="space-y-3 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">What shape is your plot?</h2>

      <div className="grid grid-cols-3 gap-2">
        <Choice
          testId="plot-preset-rectangle"
          label="Rectangle"
          icon={<Square aria-hidden className="h-4 w-4" />}
          onClick={onRectangle}
        />
        <Choice
          testId="plot-preset-lshape"
          label="L-shape"
          icon={<Shapes aria-hidden className="h-4 w-4" />}
          onClick={onLShape}
        />
        <Choice
          testId="plot-preset-custom"
          label="Custom"
          icon={<PenLine aria-hidden className="h-4 w-4" />}
          onClick={onCustom}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-garden-muted">
        Most plots are rectangles. Pick one and type your measurements — you can drag any corner
        afterwards, or draw the outline by hand if your plot is an awkward shape.
      </p>
    </section>
  );
}

function Choice({
  testId,
  label,
  icon,
  onClick,
}: {
  testId: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border border-garden-line bg-white px-1 py-2.5 text-[10px] font-medium text-garden-muted transition-colors hover:border-garden-green hover:text-garden-forest focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
    >
      {icon}
      {label}
    </button>
  );
}

function Field({
  testId,
  label,
  metres,
  unit,
  onCommit,
}: {
  testId: string;
  label: string;
  metres: number;
  unit: Parameters<typeof LengthInput>[0]['unit'];
  onCommit: (metres: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-garden-muted">{label}</span>
      <LengthInput
        testId={testId}
        label={`${label} of the plot`}
        metres={metres}
        unit={unit}
        onCommit={onCommit}
      />
    </div>
  );
}
