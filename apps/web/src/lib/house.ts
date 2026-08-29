import {
  MIN_HOUSE_SIDE,
  defaultWalls,
  houseFitsInside,
  houseSize,
  identifyOutline,
  normaliseDegrees,
  polygonCentroid,
  type HouseFootprint,
  type HouseSize,
  type Point,
} from '@garden-studio/schema';

/**
 * The house's *shape* — the footprint type, `housePolygon`, `houseSize` and the containment
 * tests — lives in `@garden-studio/schema`, because the PostGIS validator has to agree with the
 * canvas about exactly where the walls are.
 *
 * What stays here is the *gestures*: the drag, resize and rotate helpers the map screen calls.
 * They are editor behaviour, not part of the model, and the server has no use for them.
 */
export {
  MIN_HOUSE_SIDE,
  houseArea,
  houseFitsInside,
  housePolygon,
  houseSize,
  normaliseDegrees,
  polygonContainsPolygon,
  rectangleHouse,
  rectangleOutline,
  scaleHouseAbout,
  type HouseFootprint,
  type HouseSize,
} from '@garden-studio/schema';

/** Builds a custom-shape house from points clicked in world coordinates. */
export function houseFromPoints(points: Point[]): HouseFootprint | null {
  if (points.length < 3) return null;

  const centre = polygonCentroid(points);
  const outline = identifyOutline(
    points.map((point) => ({ x: point.x - centre.x, y: point.y - centre.y })),
  );

  return { outline, walls: defaultWalls(outline), openings: [], centre, rotation: 0 };
}

/** Scales the outline about its own origin so its bounding box matches the requested size. */
export function resizeHouse(house: HouseFootprint, size: Partial<HouseSize>): HouseFootprint {
  const current = houseSize(house);
  const width = Math.max(MIN_HOUSE_SIDE, size.width ?? current.width);
  const depth = Math.max(MIN_HOUSE_SIDE, size.depth ?? current.depth);

  if (current.width < 1e-9 || current.depth < 1e-9) return house;

  const scaleX = width / current.width;
  const scaleY = depth / current.depth;

  return {
    ...house,
    // Spread, so a resize keeps the vertex ids and whatever is attached to those walls.
    outline: house.outline.map((point) => ({
      ...point,
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
  };
}

export function moveHouse(house: HouseFootprint, centre: Point): HouseFootprint {
  return { ...house, centre };
}

export function rotateHouse(house: HouseFootprint, rotation: number): HouseFootprint {
  return { ...house, rotation: normaliseDegrees(rotation) };
}

/**
 * Moves the house as far towards `target` as it can go while staying inside the plot. The
 * user is dragging, so refusing outright would feel like the shape had frozen; sliding it up
 * against the fence is what they meant.
 *
 * Binary search on the fraction of the move vector, which needs no special-casing for the
 * boundary's shape.
 */
export function clampHouseInside(
  boundary: Point[],
  house: HouseFootprint,
  target: Point,
): HouseFootprint {
  const moved = moveHouse(house, target);
  if (houseFitsInside(boundary, moved)) return moved;

  // If it was not legal to begin with there is no safe fraction to fall back to.
  if (!houseFitsInside(boundary, house)) return house;

  let low = 0;
  let high = 1;

  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    const candidate = moveHouse(house, {
      x: house.centre.x + (target.x - house.centre.x) * mid,
      y: house.centre.y + (target.y - house.centre.y) * mid,
    });

    if (houseFitsInside(boundary, candidate)) low = mid;
    else high = mid;
  }

  return moveHouse(house, {
    x: house.centre.x + (target.x - house.centre.x) * low,
    y: house.centre.y + (target.y - house.centre.y) * low,
  });
}
