'use client';

import { Line } from 'react-konva';
import type Konva from 'konva';
import type { BoundaryEdge } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * Invisible-until-it-matters click targets along each edge of an outline: a wide hit area over a
 * hairline stroke, so "click a side to add a corner part way along it" is reachable without
 * drawing anything that competes with the shape itself.
 *
 * Shared by the boundary on step 1 and by a feature being reshaped on step 2.
 */
export function EdgeHitLines({
  edges,
  transform,
  hoveredIndex = null,
  selectedIndex = null,
  listening = true,
  highlight = COLOUR.stroke,
  onEdgeClick,
  onHoverChange,
  testIdPrefix,
}: {
  edges: BoundaryEdge[];
  transform: CanvasTransform;
  hoveredIndex?: number | null;
  /**
   * The side whose editor is open. Drawn as a wide, translucent stroke in the handle colour over
   * whatever the side is made of — the same treatment a selected wall gets — so the plan and the
   * panel visibly agree about which side is being described.
   */
  selectedIndex?: number | null;
  listening?: boolean;
  /** Stroke shown on hover; features use their status colour. */
  highlight?: string;
  onEdgeClick?: (index: number) => void;
  onHoverChange?: (index: number | null) => void;
  testIdPrefix: string;
}) {
  return (
    <>
      {edges.map((edge) => {
        const start = metresToPx(edge.start, transform);
        const end = metresToPx(edge.end, transform);
        const isSelected = edge.index === selectedIndex;
        const isHovered = edge.index === hoveredIndex && !isSelected;

        return (
          <Line
            key={edge.index}
            data-testid={`${testIdPrefix}-${edge.index}`}
            data-selected={isSelected}
            points={[start.x, start.y, end.x, end.y]}
            stroke={isSelected ? COLOUR.handle : isHovered ? highlight : 'transparent'}
            strokeWidth={isSelected ? 8 : isHovered ? 4 : 2}
            opacity={isSelected ? 0.55 : 1}
            lineCap="round"
            hitStrokeWidth={18}
            listening={listening}
            onMouseEnter={() => onHoverChange?.(edge.index)}
            onMouseLeave={() => onHoverChange?.(null)}
            onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
              onEdgeClick?.(edge.index);
            }}
          />
        );
      })}
    </>
  );
}
