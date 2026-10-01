'use client';

import { closestPointOnSegment, geometryVertices, type DesignElement, type Point } from '@garden-studio/schema';
import { boundaryEdges } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import type { CanvasTransform } from '@/lib/canvas-transform';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { EdgeHitLines } from '../EdgeHitLines';
import { EditableVertices } from '../EditableVertices';

/**
 * A polygon's or a path's corners, for editing on the plan.
 *
 * Step 2's reshaping tools pointed at a design element: `EdgeHitLines` for inserting a corner where
 * an edge is clicked, `EditableVertices` for dragging one. Nothing here decides anything — every
 * change goes through the store, which snaps it, refuses an outline that folds through itself or
 * leaves the plot, and resets a custom edge plan when the corner count changes.
 *
 * Fragments in the chrome layer, never a layer of their own: the stage's layer budget is four.
 */
export function VertexEditor({
  element,
  transform,
  hoveredEdge,
  onHoverEdge,
  selectedIndex,
  listening,
  pointerInMetres,
}: {
  element: DesignElement;
  transform: CanvasTransform;
  hoveredEdge: number | null;
  onHoverEdge: (index: number | null) => void;
  selectedIndex: number | null;
  listening: boolean;
  pointerInMetres: () => Point | null;
}) {
  const points = geometryVertices(element.shape);
  if (!points) return null;

  const closed = element.shape.kind === 'polygon';
  const edges = boundaryEdges(points, closed);
  const store = usePlanEditorStore.getState;

  return (
    <>
      <EdgeHitLines
        edges={edges}
        transform={transform}
        hoveredIndex={hoveredEdge}
        listening={listening}
        highlight={COLOUR.handle}
        onHoverChange={onHoverEdge}
        onEdgeClick={(index) => {
          const at = pointerInMetres();
          const edge = edges[index];
          if (!at || !edge) return;
          store().insertVertex(element.id, index, closestPointOnSegment(at, edge.start, edge.end));
        }}
        testIdPrefix="element-edge"
      />
      <EditableVertices
        vertices={points.map((point, index) => ({ id: String(index), ...point }))}
        transform={transform}
        variant="feature"
        selectedId={selectedIndex === null ? null : String(selectedIndex)}
        draggable={listening}
        listening={listening}
        onVertexDragStart={(id) => {
          store().selectVertex(Number(id));
          store().beginGesture();
        }}
        onVertexDragMove={(id, at) =>
          store().moveVertexLive(element.id, Number(id), at, { pxPerMetre: transform.scale })
        }
        onVertexDragEnd={() => store().endGesture()}
        onVertexClick={(id) => store().selectVertex(Number(id))}
        testIdPrefix="element-vertex"
      />
    </>
  );
}
