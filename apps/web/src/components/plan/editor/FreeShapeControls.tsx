'use client';

import { Spline } from 'lucide-react';
import {
  edgeLength,
  isLocked,
  MAX_CORNER_RADIUS,
  polygonEdges,
  type DesignElement,
} from '@garden-studio/schema';
import type { Unit } from '@/lib/units';
import { canConvertToPolygon, usePlanEditorStore } from '@/state/plan-editor-store';
import { LengthInput } from '../SideLengthsPanel';
import { Caption, Pill } from './Pill';

/**
 * The Size & Shape controls a free shape has in place of a width and a depth.
 *
 * A polygon or a path is edited corner by corner on the plan — this is the way in, and the numbers
 * that go with it: the corner radius, each side's length typed (one corner moves, as step 1's side
 * lengths do), and a path's width. A rectangular surface gets the one control that turns it into a
 * polygon; rectangles otherwise stay rectangles, because a structure or a table *is* its rectangle.
 */
export function FreeShapeControls({ element, unit }: { element: DesignElement; unit: Unit }) {
  const store = usePlanEditorStore;
  const editing = usePlanEditorStore((state) => state.vertexEdit?.id === element.id);
  if (isLocked(element)) return null;

  if (element.shape.kind === 'rect') {
    if (!canConvertToPolygon(element)) return null;
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-garden-muted">
          A rectangle. Make it a free shape to move its corners one at a time.
        </p>
        <Pill
          testId="convert-to-free-shape"
          icon={<Spline aria-hidden className="h-3.5 w-3.5" />}
          onClick={() => {
            store.getState().convertToPolygon(element.id);
            store.getState().openVertexEdit(element.id);
          }}
        >
          Free shape
        </Pill>
      </div>
    );
  }

  if (element.shape.kind !== 'polygon' && element.shape.kind !== 'polyline') return null;
  const shape = element.shape;
  const current = () => store.getState().present.elements.find((item) => item.id === element.id) ?? element;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-garden-muted">
          {editing
            ? 'Drag a corner, click an edge to add one, or pick a corner and press Delete.'
            : 'Double-click the shape on the plan, or edit its corners here.'}
        </p>
        <Pill
          testId="edit-corners"
          icon={<Spline aria-hidden className="h-3.5 w-3.5" />}
          onClick={() =>
            editing ? store.getState().closeVertexEdit() : store.getState().openVertexEdit(element.id)
          }
        >
          {editing ? 'Done' : 'Edit corners'}
        </Pill>
      </div>

      {shape.kind === 'polygon' ? (
        <>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-garden-muted">Corners</span>
            <input
              type="range"
              aria-label="Corner radius"
              data-testid="element-corner-radius"
              min={0}
              max={MAX_CORNER_RADIUS}
              step={0.1}
              value={shape.cornerRadius}
              onChange={(event) =>
                store.getState().setCornerRadiusLive(element.id, Number(event.target.value))
              }
              /* One slide is one undo entry, not one per tick — step 2's slider never was. */
              onPointerDown={() => store.getState().beginGesture()}
              onPointerUp={() => store.getState().endGesture()}
              onPointerCancel={() => store.getState().endGesture()}
              onBlur={() => store.getState().endGesture()}
              onKeyDown={() => store.getState().beginGesture()}
              onKeyUp={() => store.getState().endGesture()}
              className="min-w-0 flex-1 accent-garden-green"
            />
            <span className="w-10 text-right text-xs tabular-nums">{shape.cornerRadius.toFixed(1)} m</span>
          </label>

          <div>
            <Caption>Sides</Caption>
            <ol data-testid="element-sides" className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1.5">
              {polygonEdges(shape.points).map((edge) => (
                <li key={edge.index} className="flex min-w-0 items-center gap-1.5">
                  <span className="w-5 shrink-0 text-[11px] text-garden-muted tabular-nums">
                    {edge.index + 1}
                  </span>
                  <LengthInput
                    testId={`element-side-${edge.index}`}
                    label={`Side ${edge.index + 1} length`}
                    metres={edgeLength(edge.start, edge.end)}
                    unit={unit}
                    readMetres={() => {
                      const now = current().shape;
                      if (now.kind !== 'polygon') return 0;
                      const side = polygonEdges(now.points)[edge.index];
                      return side ? edgeLength(side.start, side.end) : 0;
                    }}
                    onCommit={(metres) => store.getState().setSideLength(element.id, edge.index, metres)}
                  />
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <label className="flex min-w-0 items-center gap-1.5">
          <span className="w-16 shrink-0 text-[11px] text-garden-muted">Width</span>
          <LengthInput
            testId="element-path-width"
            label="Path width"
            metres={shape.width}
            unit={unit}
            readMetres={() => {
              const now = current().shape;
              return now.kind === 'polyline' ? now.width : 0;
            }}
            onCommit={(metres) => store.getState().setPathWidth(element.id, metres)}
          />
        </label>
      )}
    </div>
  );
}
