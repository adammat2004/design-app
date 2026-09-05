'use client';

import { Group, Line, Text } from 'react-konva';
import {
  boundaryPolygon,
  resolvedGates,
  streetEdge,
  streetOutward,
  midpoint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { STREET_KERB_OFFSET, STREET_LABEL_OFFSET } from '@/lib/materials/symbols/property';
import { SwingArc } from './HouseOpenings';

/**
 * Gates in the fence and the street beyond it, drawn where the plan is.
 *
 * The boundary twin of `HouseOpenings`: a gate is a gap in the fence with its leaf standing open
 * and a quarter arc into the garden, and the street is a dashed kerb outside the edge that faces
 * it with a word beside it. Both resolve through `gates.ts`, so what is drawn is what the
 * generator will use — and a gate that no longer resolves draws nothing rather than something
 * plausible.
 *
 * Drawn on every canvas that shows the property: step 1 where they are placed, step 2 as context,
 * and steps 4 and 5 so the side path visibly goes somewhere.
 */
export function GateMarks({
  site,
  transform,
  paper = '#ffffff',
}: {
  site: Pick<SiteSection, 'vertices' | 'gates' | 'streetEdgeVertexId' | 'house'>;
  transform: CanvasTransform;
  /** What the fence line is drawn over, so the gap reads as an absence. */
  paper?: string;
}) {
  const gates = resolvedGates(site);
  const street = streetEdge(site);
  const outward = streetOutward(site);

  return (
    <Group listening={false}>
      {street && outward ? (
        <StreetMarker segment={street} outward={outward} transform={transform} />
      ) : null}

      {gates.map(({ gate, segment, inward }) => {
        const from = metresToPx(segment[0], transform);
        const to = metresToPx(segment[1], transform);

        return (
          <Group key={gate.id}>
            {/* The gap: the fence painted out for the width of the gate. */}
            <Line
              data-testid={`gate-mark-${gate.id}`}
              points={[from.x, from.y, to.x, to.y]}
              stroke={paper}
              strokeWidth={6}
              lineCap="butt"
            />
            <SwingArc
              hinge={segment[0]}
              closedTowards={segment[1]}
              normal={{ x: -inward.x, y: -inward.y }}
              inward
              transform={transform}
              stroke={COLOUR.fencePost}
            />
          </Group>
        );
      })}
    </Group>
  );
}

/** A dashed kerb line just outside the street edge, and the word beside it. */
function StreetMarker({
  segment,
  outward,
  transform,
}: {
  segment: [Point, Point];
  outward: Point;
  transform: CanvasTransform;
}) {
  const shift = (point: Point, by: number): Point => ({
    x: point.x + outward.x * by,
    y: point.y + outward.y * by,
  });
  const a = metresToPx(shift(segment[0], STREET_KERB_OFFSET), transform);
  const b = metresToPx(shift(segment[1], STREET_KERB_OFFSET), transform);
  const label = metresToPx(shift(midpoint(segment[0], segment[1]), STREET_LABEL_OFFSET), transform);

  return (
    <Group>
      <Line
        data-testid="street-mark"
        points={[a.x, a.y, b.x, b.y]}
        stroke={COLOUR.measurement}
        strokeWidth={2}
        dash={[8, 5]}
        opacity={0.8}
      />
      <Text
        text="Street"
        fontSize={11}
        fontStyle="600"
        fill={COLOUR.measurement}
        x={label.x}
        y={label.y}
        offsetX={20}
        offsetY={6}
        width={40}
        align="center"
      />
    </Group>
  );
}

/** Kept so a caller can draw the boundary as a fence with gaps at the gates. */
export function gateGaps(
  site: Pick<SiteSection, 'vertices' | 'gates' | 'streetEdgeVertexId' | 'house'>,
): [Point, Point][] {
  return resolvedGates(site).map((entry) => entry.segment);
}

export { boundaryPolygon };
