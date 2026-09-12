'use client';

import { Group, Line } from 'react-konva';
import type Konva from 'konva';
import {
  houseWalls,
  openingNormal,
  openingSegment,
  wallSegment,
  type HouseFootprint,
  type Opening,
} from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import {
  swingGeometry,
  WALL_THICKNESS,
  type SwingGeometry,
} from '@/lib/materials/symbols/property';

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

export function HouseOpenings({
  house,
  transform,
  selectedWallId = null,
  selectedOpeningId = null,
  onSelectWall,
  onSelectOpening,
}: {
  house: HouseFootprint;
  transform: CanvasTransform;
  selectedWallId?: string | null;
  selectedOpeningId?: string | null;
  /** Omitted on screens where the house is context rather than something being edited. */
  onSelectWall?: (wallId: string) => void;
  /** Omitted likewise; given, an opening can be picked out of the wall it is in. */
  onSelectOpening?: (openingId: string) => void;
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
                data-selected={isSelected}
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
        <OpeningMark
          key={opening.id}
          house={house}
          opening={opening}
          transform={transform}
          selected={opening.id === selectedOpeningId}
          onSelect={onSelectOpening}
        />
      ))}
    </Group>
  );
}

function OpeningMark({
  house,
  opening,
  transform,
  selected = false,
  onSelect,
}: {
  house: HouseFootprint;
  opening: Opening;
  transform: CanvasTransform;
  selected?: boolean;
  onSelect?: ((openingId: string) => void) | undefined;
}) {
  const segment = openingSegment(house, opening);
  const normal = openingNormal(house, opening);
  if (!segment || !normal) return null;

  const [start, end] = segment;
  const from = metresToPx(start, transform);
  const to = metresToPx(end, transform);

  /*
   * The gap is cut through the drawn wall, which is a band of `WALL_THICKNESS` *inside* the
   * outline. So the cut runs half a wall in from the line the opening sits on, and is exactly one
   * wall thick — a stroke centred on the outline would cut half of it into the garden.
   */
  const half = WALL_THICKNESS / 2;
  const gapFrom = metresToPx(
    { x: start.x - normal.x * half, y: start.y - normal.y * half },
    transform,
  );
  const gapTo = metresToPx({ x: end.x - normal.x * half, y: end.y - normal.y * half }, transform);

  // Upstairs openings are drawn faintly: they are real, but nothing walks out of one.
  const upstairs = opening.floorLevel > 0;
  const glazed = opening.type === 'window' || opening.type === 'upper-window';

  /*
   * A window is not a hole you walk through, so it is not drawn as one: the wall carries on past it
   * and the glazing is a pair of fine lines across the band. Drawn as a gap, every window read as a
   * doorway on the plan — which is exactly the thing a reader would act on.
   */
  const gapWidth = Math.max(3, WALL_THICKNESS * transform.scale + 1);

  const swing =
    opening.swing === 'none' ? null : swingGeometry(start, end, normal, opening.swing === 'inward');

  return (
    <Group
      listening={!!onSelect}
      opacity={upstairs ? 0.35 : 1}
      onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
        if (!onSelect) return;
        event.cancelBubble = true;
        onSelect(opening.id);
      }}
      onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
        if (onSelect) event.cancelBubble = true;
      }}
    >
      {/*
        The gap. Drawn over the wall in the house's own fill so it reads as an absence rather than
        as another line laid on top of the building.
      */}
      {glazed ? null : (
        <Line
          data-testid={`opening-mark-${opening.id}`}
          points={[gapFrom.x, gapFrom.y, gapTo.x, gapTo.y]}
          stroke={COLOUR.houseFill}
          strokeWidth={gapWidth}
          lineCap="butt"
          hitStrokeWidth={Math.max(gapWidth, 14)}
        />
      )}
      <Line
        data-testid={glazed ? `opening-mark-${opening.id}` : undefined}
        data-selected={selected}
        points={[from.x, from.y, to.x, to.y]}
        stroke={selected ? COLOUR.stroke : COLOUR.handle}
        strokeWidth={selected ? 4 : 2.5}
        lineCap="butt"
        hitStrokeWidth={14}
      />
      {/* The second pane line, half a wall in, which is what makes a window read as glazed. */}
      {glazed ? (
        <Line
          points={[gapFrom.x, gapFrom.y, gapTo.x, gapTo.y]}
          stroke={selected ? COLOUR.stroke : COLOUR.handle}
          strokeWidth={Math.max(1, 1.5)}
          lineCap="butt"
          listening={false}
        />
      ) : null}

      {swing ? <SwingArc swing={swing} transform={transform} /> : null}
    </Group>
  );
}

/**
 * The quarter circle a hinged leaf sweeps, with the leaf shown open.
 *
 * Rendered so the threshold keep-clear reads as a consequence of something visible rather than an
 * arbitrary exclusion zone. It is deliberately **not** a separate constraint: for an ordinary door
 * the arc sits well inside the 1.8 m threshold rectangle that already keeps beds out of the way, so
 * counting it twice would shrink the garden for no gain.
 *
 * **It is handed the geometry rather than working it out.** The same arc was computed here and
 * again inside the composer's `drawAccess`, and the two had already diverged — the composer always
 * hinged on the segment's first end, so a gate and the same gate on an exported PNG could open from
 * opposite sides. `swingGeometry` decides; this and the composer both draw. Exported for
 * `GateMarks`, which hangs one leaf or two by the same convention.
 */
export function SwingArc({
  swing,
  transform,
  stroke = COLOUR.houseStroke,
}: {
  swing: SwingGeometry;
  transform: CanvasTransform;
  stroke?: string;
}) {
  const points = swing.arc.flatMap((point) => {
    const at = metresToPx(point, transform);
    return [at.x, at.y];
  });

  const hingePx = metresToPx(swing.hinge, transform);
  const openPx = metresToPx(swing.open, transform);

  return (
    <>
      <Line points={points} stroke={stroke} strokeWidth={1} dash={[3, 3]} opacity={0.7} />
      {/* The leaf itself, standing open. */}
      <Line
        points={[hingePx.x, hingePx.y, openPx.x, openPx.y]}
        stroke={stroke}
        strokeWidth={1.5}
        opacity={0.8}
      />
    </>
  );
}
