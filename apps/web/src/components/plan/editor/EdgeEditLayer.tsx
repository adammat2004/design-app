'use client';

import { Circle, Line } from 'react-konva';
import type Konva from 'konva';
import {
  distanceAlongSide,
  runPolyline,
  type Point,
  type ResolvedEdgeRun,
  type SideChain,
} from '@garden-studio/schema';
import { EDGE_TREATMENT_COLOUR } from '@/lib/canvas-colours';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * A surface's boundary treatments, edited where they are.
 *
 * Mounted as fragments inside the editor's **chrome layer**, never a `Layer` of its own — the stage
 * has a budget of four and `ai-redesign.spec.ts` counts them. It draws only while the selected
 * surface's Edges tab is open, and it is deliberately quiet: the rendered course is already on the
 * plan underneath, so this is the editing overlay on top of it, not a second drawing of the edging.
 *
 * - **Every side** as a faint dashed line, so the whole boundary is visibly editable without a
 *   control at every corner.
 * - **Every run** in its treatment's colour; the selected one heavier, on a white casing.
 * - **Bare boundary under the pointer** highlights the stretch a click would edge — the free part of
 *   the boundary-graph interval there, so a hover snaps to "where this meets the lawn" rather than
 *   to an arbitrary point.
 * - **The selected run's two ends**, and nothing else, as handles. They slide along the side and
 *   cannot leave it: a drag passes on the pointer's distance *along the side* and throws the rest
 *   away, the construction `AttachmentHandle` uses for a gate.
 *
 * Read-only in Auto: the runs are shown so the automatic answer can be inspected, and nothing on
 * them listens.
 */

const END_RADIUS = 6;
/** How far each handle's grab area reaches. There is no body drag to swallow, so no gating. */
const END_HIT = 14;
/** The boundary's own hit width while bare, so a side is easy to find with a trackpad. */
const SIDE_HIT = 16;

const BARE = 'rgba(71, 85, 105, 0.45)';
const HOVER = '#b5623a';

export interface EdgeEditLayerProps {
  chains: SideChain[];
  runs: ResolvedEdgeRun[];
  editable: boolean;
  selectedRunId: string | null;
  hoveredRunId: string | null;
  /** The free stretch a click would edge, or null. Computed by the caller from the graph. */
  bareHover: { side: number; from: number; to: number } | null;
  transform: CanvasTransform;
  listening: boolean;
  onHoverBare: (side: number, distance: number | null) => void;
  onAddAt: (side: number, distance: number) => void;
  onSelectRun: (runId: string) => void;
  onHoverRun: (runId: string | null) => void;
  onEndDragStart: () => void;
  onEndDrag: (runId: string, end: 'from' | 'to', distance: number) => void;
  onEndDragEnd: () => void;
  /** Where a run's end actually is after a frame, which is where its handle must be put back. */
  readEnd: (runId: string, end: 'from' | 'to') => Point | null;
}

export function EdgeEditLayer({
  chains,
  runs,
  editable,
  selectedRunId,
  hoveredRunId,
  bareHover,
  transform,
  listening,
  onHoverBare,
  onAddAt,
  onSelectRun,
  onHoverRun,
  onEndDragStart,
  onEndDrag,
  onEndDragEnd,
  readEnd,
}: EdgeEditLayerProps) {
  const toPx = (points: Point[]) => points.flatMap((point) => {
    const at = metresToPx(point, transform);
    return [at.x, at.y];
  });

  /** The pointer, as a distance along a side. */
  const distanceOn = (chain: SideChain, event: Konva.KonvaEventObject<MouseEvent | TouchEvent | DragEvent>) => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return null;
    // The stage may be offset by a pan in flight; the layer's own transform undoes it.
    const local = event.target.getLayer()?.getAbsoluteTransform().copy().invert().point(pointer) ?? pointer;
    return distanceAlongSide(chain, pxToMetres(local, transform));
  };

  const selected = runs.find((run) => run.runId !== null && run.runId === selectedRunId) ?? null;
  const hoverChain = bareHover ? chains[bareHover.side] : undefined;

  return (
    <>
      {chains.map((chain) => (
        <Line
          key={`side-${chain.side}`}
          data-testid={`edge-side-${chain.side}`}
          points={toPx(chain.points)}
          stroke={BARE}
          strokeWidth={1.5}
          dash={[5, 5]}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={SIDE_HIT}
          listening={listening && editable}
          onMouseMove={(event) => {
            const distance = distanceOn(chain, event);
            if (distance !== null) onHoverBare(chain.side, distance);
          }}
          onMouseLeave={() => onHoverBare(chain.side, null)}
          onClick={(event) => {
            event.cancelBubble = true;
            const distance = distanceOn(chain, event);
            if (distance !== null) onAddAt(chain.side, distance);
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            const distance = distanceOn(chain, event);
            if (distance !== null) onAddAt(chain.side, distance);
          }}
        />
      ))}

      {bareHover && hoverChain ? (
        <Line
          points={toPx(runPolyline(hoverChain, bareHover.from, bareHover.to))}
          stroke={HOVER}
          strokeWidth={4}
          opacity={0.5}
          dash={[8, 5]}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : null}

      {selected ? (
        // A white casing under the selected run, so it reads over any material without a glow.
        <Line
          points={toPx(selected.points)}
          stroke="#ffffff"
          strokeWidth={10}
          opacity={0.85}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : null}

      {runs.map((run) => {
        const isSelected = run.runId !== null && run.runId === selectedRunId;
        const isHovered = run.runId !== null && run.runId === hoveredRunId && !isSelected;

        return (
          <Line
            key={run.id}
            data-testid={`edge-run-${run.runId ?? run.id}`}
            data-selected={isSelected}
            points={toPx(run.points)}
            stroke={EDGE_TREATMENT_COLOUR[run.treatment] ?? HOVER}
            strokeWidth={isSelected ? 6 : isHovered ? 5 : 3.5}
            opacity={editable ? 1 : 0.75}
            lineCap="butt"
            lineJoin="round"
            hitStrokeWidth={SIDE_HIT}
            listening={listening && editable && run.runId !== null}
            onMouseEnter={() => onHoverRun(run.runId)}
            onMouseLeave={() => onHoverRun(null)}
            onClick={(event) => {
              event.cancelBubble = true;
              if (run.runId) onSelectRun(run.runId);
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              if (run.runId) onSelectRun(run.runId);
            }}
          />
        );
      })}

      {selected && editable
        ? (['from', 'to'] as const).map((end) => {
            const chain = chains[selected.side];
            const at = metresToPx(end === 'from' ? selected.points[0]! : selected.points.at(-1)!, transform);

            return (
              <Circle
                key={`${selected.runId}-${end}`}
                data-testid={`edge-run-handle-${end}`}
                x={at.x}
                y={at.y}
                radius={END_RADIUS}
                fill="#ffffff"
                stroke={EDGE_TREATMENT_COLOUR[selected.treatment] ?? HOVER}
                strokeWidth={2}
                hitStrokeWidth={END_HIT}
                draggable={listening}
                listening={listening}
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                }}
                onDragStart={(event) => {
                  event.cancelBubble = true;
                  onEndDragStart();
                }}
                onDragMove={(event) => {
                  event.cancelBubble = true;
                  if (!chain || !selected.runId) return;
                  const node = event.target;
                  const distance = distanceAlongSide(chain, pxToMetres({ x: node.x(), y: node.y() }, transform));
                  onEndDrag(selected.runId, end, distance);
                  // Put the handle where the end actually is: on the side, and at a limit if refused.
                  const settled = readEnd(selected.runId, end);
                  if (settled) node.position(metresToPx(settled, transform));
                }}
                onDragEnd={(event) => {
                  event.cancelBubble = true;
                  if (selected.runId) {
                    const settled = readEnd(selected.runId, end);
                    if (settled) event.target.position(metresToPx(settled, transform));
                  }
                  onEndDragEnd();
                }}
              />
            );
          })
        : null}
    </>
  );
}
