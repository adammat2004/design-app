import { rotatePoint, type Point } from '@garden-studio/schema';

/**
 * The property drawn as a building and an enclosure rather than as two outlines.
 *
 * Pure geometry and constants shared by the Konva canvases and the plan composer, like
 * `structures.ts`. Nothing here is geometry of record: the house's outline and the boundary are
 * exactly what they were, and this decides only how thick the wall is drawn and where the fence
 * throws its shade.
 */

/** How thick the house's external wall is drawn, in metres. A cavity wall is about this. */
export const WALL_THICKNESS = 0.3;

/**
 * How far the house's shadow reaches onto the garden, in metres, and how dark it is.
 *
 * A drawing convention in the contact-shadow class, not a solar claim: fixed in depth, never scaled
 * by `HOUSE_HEIGHT`, and drawn whether or not the plan knows where on Earth it is. It says "this
 * building stands up out of the ground", which every plan needs to say — where the *cast* layer,
 * the one that says where the shade falls at four o'clock, stays gated on `site.location`.
 *
 * This is the strongest single cue that the house is a building rather than another garden
 * surface, and it replaces the one that used to do that job badly: the interior was tiled with a
 * photograph of pale oak flooring, which read as a very large deck and made the house the
 * brightest, most textured object in a drawing whose subject is the garden.
 */
export const HOUSE_SHADOW_OFFSET = 0.45;
export const HOUSE_SHADOW_ALPHA = 0.16;

/**
 * The house's footprint, pushed away from the light.
 *
 * An offset copy rather than a projection. `projectShadow` in `packages/schema` does the real
 * thing — base, cap and the quads swept between — and is what the cast layer uses; this is the
 * tight dark edge at the base of the wall, so a translation is not an approximation of it but a
 * different mark entirely, which is why the two coexist without looking muddy.
 */
export function houseGroundShadow(outline: Point[], light: Point): Point[] {
  return outline.map((point) => ({
    x: point.x - light.x * HOUSE_SHADOW_OFFSET,
    y: point.y - light.y * HOUSE_SHADOW_OFFSET,
  }));
}

/** How far the fence's shade reaches into the garden, in metres. A convention, not a solar claim. */
export const FENCE_SHADE_DEPTH = 0.35;

/** The kerb drawn outside the street edge, and the word "Street" beyond it, in metres. */
export const STREET_KERB_OFFSET = 0.6;
export const STREET_LABEL_OFFSET = 1.4;

/**
 * The strips of shade along the fence panels that face away from the light.
 *
 * One quad per edge whose *inward* normal points away from the sun — the panels the sun is behind.
 * A drawing convention in the contact-shadow class: proportional to nothing, fixed in depth, and
 * lit by whichever light the pass is lit by, so it agrees with the cast layer when there is one.
 * Returned unmerged; corners overlap by a sliver, which at the alpha these are drawn at does not
 * show.
 */
export function fenceShadeBands(
  boundary: Point[],
  light: Point,
  depth = FENCE_SHADE_DEPTH,
): Point[][] {
  if (boundary.length < 3) return [];

  // Which way is "in" depends on the winding; the signed area says which.
  let twice = 0;
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  const clockwise = twice > 0;

  const bands: Point[][] = [];

  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    // Inward normal: the left-hand normal for a clockwise ring in this y-down frame.
    const inward = clockwise
      ? { x: -dy / length, y: dx / length }
      : { x: dy / length, y: -dx / length };

    if (inward.x * light.x + inward.y * light.y >= 0) continue;

    bands.push([
      a,
      b,
      { x: b.x + inward.x * depth, y: b.y + inward.y * depth },
      { x: a.x + inward.x * depth, y: a.y + inward.y * depth },
    ]);
  }

  return bands;
}

/* ---------------------------------------------------------------- openings in a line */

/** How many segments make a swung leaf's arc read as a curve. */
export const SWING_ARC_STEPS = 12;

/** How far either side of the boundary an open gap's end ticks run, in metres. */
export const OPEN_GAP_TICK = 0.35;

/**
 * A leaf standing open, and the quarter circle it swings through, in world metres.
 *
 * Shared by the Konva canvases and the plan composer. It was written twice — once as `SwingArc`
 * and once inline in `drawAccess` — and the copies had already begun to differ: the composer
 * always swung the leaf from the first end of the segment, so a door and the same door on an
 * exported PNG could hinge on opposite sides. One function, one answer.
 *
 * Returns world metres rather than pixels for the reason `useSurfacePattern` does: metres are the
 * frame the two backends agree on, and a function that returned pixels could only serve one.
 */
export interface SwingGeometry {
  hinge: Point;
  /** The leaf's far end, shown open. */
  open: Point;
  /** The arc, as a polyline from shut to open. */
  arc: Point[];
}

export function swingGeometry(
  hinge: Point,
  closedTowards: Point,
  normal: Point,
  inward: boolean,
): SwingGeometry | null {
  const dx = closedTowards.x - hinge.x;
  const dy = closedTowards.y - hinge.y;
  const radius = Math.hypot(dx, dy);
  if (radius < 1e-6) return null;

  const closed = { x: dx / radius, y: dy / radius };
  const open = inward ? { x: -normal.x, y: -normal.y } : normal;

  // Which way round the circle takes the leaf from shut to open, in this y-down frame.
  const turn = closed.x * open.y - closed.y * open.x >= 0 ? 90 : -90;

  const arc: Point[] = [];
  for (let step = 0; step <= SWING_ARC_STEPS; step += 1) {
    const direction = rotatePoint(closed, { x: 0, y: 0 }, (turn * step) / SWING_ARC_STEPS);
    arc.push({ x: hinge.x + direction.x * radius, y: hinge.y + direction.y * radius });
  }

  return { hinge, open: arc[arc.length - 1]!, arc };
}

/**
 * What is hung in a gap in the boundary, which is the whole difference between the three kinds.
 *
 * A pedestrian gate is one leaf on a hinge. A driveway is a pair, each half the opening and hung
 * at opposite ends — the drawing convention for a double gate, and what stops a 3 m opening
 * reading as a very wide garden gate. An open gap has nothing hung in it at all, so it gets none:
 * drawing a leaf there would claim a gate the user said was absent.
 */
export function gateSwings(
  segment: [Point, Point],
  inward: Point,
  kind: 'pedestrian' | 'vehicle' | 'open',
): SwingGeometry[] {
  if (kind === 'open') return [];

  const outward = { x: -inward.x, y: -inward.y };

  if (kind === 'vehicle') {
    const middle = {
      x: (segment[0].x + segment[1].x) / 2,
      y: (segment[0].y + segment[1].y) / 2,
    };

    return [
      swingGeometry(segment[0], middle, outward, true),
      swingGeometry(segment[1], middle, outward, true),
    ].filter((swing): swing is SwingGeometry => swing !== null);
  }

  const swing = swingGeometry(segment[0], segment[1], outward, true);
  return swing ? [swing] : [];
}

/**
 * The two short ticks that mark where an enclosure stops at an open gap. Square to the boundary
 * and crossing it, so the break reads as deliberate rather than as a fence that ran out.
 */
export function openGapTicks(segment: [Point, Point], inward: Point): [Point, Point][] {
  return [segment[0], segment[1]].map((end) => [
    { x: end.x - inward.x * OPEN_GAP_TICK, y: end.y - inward.y * OPEN_GAP_TICK },
    { x: end.x + inward.x * OPEN_GAP_TICK, y: end.y + inward.y * OPEN_GAP_TICK },
  ]);
}
