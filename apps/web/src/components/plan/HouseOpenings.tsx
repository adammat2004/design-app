'use client';

import { Group, Line } from 'react-konva';
import type Konva from 'konva';
import {
  houseWalls,
  openingNormal,
  openingSegment,
  rotatePoint,
  wallSegment,
  type HouseFootprint,
  type Opening,
  type Point,
} from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * The openings, drawn where the design happens.
 *
 * The elevation strip is where a door is *placed*, but a door only means something in relation to
 * the garden — so it has to appear on the plan too, or the strip is a form the user fills in and
 * never sees the effect of. Each opening is drawn as a gap in the wall, and a hinged door carries
 * its swing arc so the keep-clear rule in front of it reads as a consequence rather than a mystery.
 *
 * Drawn beside `HouseShape` rather than inside it, because `HouseShape` is shared with step 2 where
 * the house is inert background and clicking a wall must do nothing.
 *
 * Everything here goes through `openingSegment` / `openingNormal`, so what is drawn is what the
 * generator will use. An opening that does not currently resolve — a wall a resize has shortened
 * under it — draws nothing at all rather than being clamped somewhere plausible.
 */

/** How many segments make the swing arc read as a curve. */
const ARC_STEPS = 12;

export function HouseOpenings({
  house,
  transform,
  selectedWallId = null,
  onSelectWall,
}: {
  house: HouseFootprint;
  transform: CanvasTransform;
  selectedWallId?: string | null;
  /** Omitted on screens where the house is context rather than something being edited. */
  onSelectWall?: (wallId: string) => void;
}) {
  const walls = houseWalls(house);

  return (
    <Group>
      {/* Fat invisible strokes so a wall can be picked without hitting the footprint's own drag. */}
      {onSelectWall
        ? walls.map((wall) => {
            const segment = wallSegment(house, wall.id);
            if (!segment) return null;

            const from = metresToPx(segment[0], transform);
            const to = metresToPx(segment[1], transform);
            const isSelected = wall.id === selectedWallId;

            return (
              <Line
                key={`hit-${wall.id}`}
                data-testid={`wall-${wall.id}`}
                points={[from.x, from.y, to.x, to.y]}
                stroke={isSelected ? COLOUR.handle : 'transparent'}
                strokeWidth={isSelected ? 5 : 14}
                opacity={isSelected ? 0.75 : 1}
                onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                  event.cancelBubble = true;
                  onSelectWall(wall.id);
                }}
                onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
                  event.cancelBubble = true;
                }}
              />
            );
          })
        : null}

      {house.openings.map((opening) => (
        <OpeningMark key={opening.id} house={house} opening={opening} transform={transform} />
      ))}
    </Group>
  );
}

function OpeningMark({
  house,
  opening,
  transform,
}: {
  house: HouseFootprint;
  opening: Opening;
  transform: CanvasTransform;
}) {
  const segment = openingSegment(house, opening);
  const normal = openingNormal(house, opening);
  if (!segment || !normal) return null;

  const [start, end] = segment;
  const from = metresToPx(start, transform);
  const to = metresToPx(end, transform);

  // Upstairs openings are drawn faintly: they are real, but nothing walks out of one.
  const upstairs = opening.floorLevel > 0;

  return (
    <Group listening={false} opacity={upstairs ? 0.35 : 1}>
      {/*
        The gap. Drawn over the wall in the house's own fill so it reads as an absence rather than
        as another line laid on top of the building.
      */}
      <Line
        data-testid={`opening-mark-${opening.id}`}
        points={[from.x, from.y, to.x, to.y]}
        stroke={COLOUR.houseFill}
        strokeWidth={5}
        lineCap="butt"
      />
      <Line
        points={[from.x, from.y, to.x, to.y]}
        stroke={COLOUR.handle}
        strokeWidth={2.5}
        lineCap="butt"
      />

      {opening.swing !== 'none' ? (
        <SwingArc
          hinge={start}
          closedTowards={end}
          normal={normal}
          inward={opening.swing === 'inward'}
          transform={transform}
        />
      ) : null}
    </Group>
  );
}

/**
 * The quarter circle a hinged door sweeps, with its leaf shown open.
 *
 * Rendered so the threshold keep-clear reads as a consequence of something visible rather than an
 * arbitrary exclusion zone. It is deliberately **not** a separate constraint: for an ordinary door
 * the arc sits well inside the 1.8 m threshold rectangle that already keeps beds out of the way, so
 * counting it twice would shrink the garden for no gain.
 */
function SwingArc({
  hinge,
  closedTowards,
  normal,
  inward,
  transform,
}: {
  hinge: Point;
  closedTowards: Point;
  normal: Point;
  inward: boolean;
  transform: CanvasTransform;
}) {
  const dx = closedTowards.x - hinge.x;
  const dy = closedTowards.y - hinge.y;
  const radius = Math.hypot(dx, dy);
  if (radius < 1e-6) return null;

  const closed = { x: dx / radius, y: dy / radius };
  const open = inward ? { x: -normal.x, y: -normal.y } : normal;

  // Which way round the circle takes the leaf from shut to open, in this y-down frame.
  const turn = closed.x * open.y - closed.y * open.x >= 0 ? 90 : -90;

  const points: number[] = [];
  for (let step = 0; step <= ARC_STEPS; step += 1) {
    const direction = rotatePoint(closed, { x: 0, y: 0 }, (turn * step) / ARC_STEPS);
    const at = metresToPx(
      { x: hinge.x + direction.x * radius, y: hinge.y + direction.y * radius },
      transform,
    );
    points.push(at.x, at.y);
  }

  const hingePx = metresToPx(hinge, transform);
  const openPx = { x: points[points.length - 2]!, y: points[points.length - 1]! };

  return (
    <>
      <Line
        points={points}
        stroke={COLOUR.houseStroke}
        strokeWidth={1}
        dash={[3, 3]}
        opacity={0.7}
      />
      {/* The leaf itself, standing open. */}
      <Line
        points={[hingePx.x, hingePx.y, openPx.x, openPx.y]}
        stroke={COLOUR.houseStroke}
        strokeWidth={1.5}
        opacity={0.8}
      />
    </>
  );
}
