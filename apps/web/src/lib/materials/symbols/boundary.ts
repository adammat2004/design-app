import type { BoundaryKind, BoundaryRun, Point } from '@garden-studio/schema';

/**
 * How each kind of boundary is drawn.
 *
 * Pure geometry and a palette, shared by the Konva canvases and the plan composer — the same
 * arrangement `structures.ts` uses for pergola posts and shed ridges, and for the same reason:
 * there are two renderers, and anything either of them works out for itself is something the two
 * can quietly disagree about. Nothing here is geometry of record. The boundary polygon is exactly
 * the polygon the user drew; this decides only what is drawn *on* it.
 *
 * A run is drawn as a band of its real thickness rather than as a stroke, for the reason the
 * material renderer draws joints as background rather than as lines: a stroke needs a pixel width,
 * which either vanishes zoomed out or swells zoomed in, where a band of real metres is correct at
 * every zoom by construction. A 0.7 m boundary hedge really does take that much of the garden, and
 * a plan that draws it as a line is lying about the space available.
 */

export interface BoundaryPalette {
  /** The band on the ground. */
  body: string;
  /** Posts, piers, or the hedge's own darker mass. `null` where the kind has none. */
  detail: string | null;
  /** Metres between posts or balusters. `null` where the kind has none. */
  postSpacing: number | null;
  /** A line drawn along the run's centre — a wall's coping, a fence's rail. */
  cap: string | null;
  /** Whether the run is drawn as a dashed line with no body at all. */
  dashed: boolean;
}

export const BOUNDARY_PALETTE: Record<BoundaryKind, BoundaryPalette> = {
  /** What every plot had before there was a choice, kept exactly. */
  fence: { body: '#9a8460', detail: '#7a6747', postSpacing: 1.8, cap: null, dashed: false },
  /*
   * Piers at 2.4 m rather than posts at 1.8: a garden wall is built in bays, and the pier is what
   * says masonry rather than timber at a glance. The coping is the light line along the top, and
   * it is most of what distinguishes a wall from a very thick fence at plan scale.
   */
  wall: { body: '#9a8f81', detail: '#847a6d', postSpacing: 2.4, cap: '#bcb3a8', dashed: false },
  /*
   * Drawn by the same crown-and-mass logic a garden hedge uses, so a boundary hedge and a hedge
   * across the middle of the garden are the same plant. `postSpacing` is the crown pitch.
   */
  hedge: { body: '#385a31', detail: '#47703e', postSpacing: 0.5, cap: null, dashed: false },
  /*
   * You can see through a railing, so the plan should too: a thin band, closely spaced balusters,
   * and no cap. Drawing it like a solid fence would tell the user their view is blocked when the
   * whole point of choosing railings is that it is not.
   */
  railing: { body: '#5c6168', detail: '#484d53', postSpacing: 0.3, cap: null, dashed: false },
  /*
   * Nothing is built here, and that is a statement rather than an absence — which is why it is a
   * dashed cadastral line rather than no mark at all. "There is no fence on this side" and "we
   * never asked about this side" must not look the same on the drawing.
   */
  open: { body: '#8a938c', detail: null, postSpacing: null, cap: null, dashed: true },
};

/** How thin a run is allowed to draw before it is stroked as a line instead of filled as a band. */
export const MIN_BAND_PX = 1.2;

/** Below this many pixels apart, posts stop being individually legible and are dropped. */
export const MIN_POST_SPACING_PX = 9;

/**
 * The band one run occupies, as a quad, pushed **inward** from the boundary line.
 *
 * Inward on purpose. The boundary polygon is the legal edge of the property, so a wall drawn
 * straddling it would be half on the neighbour's land — the same clamp `borderRegions` applies
 * when it refuses to plant outside the plot. It also means the garden's usable area visibly
 * shrinks when a thick hedge is chosen, which is true and is the point.
 */
export function boundaryBand(run: BoundaryRun, inward: Point): Point[] {
  const depth = run.thickness;
  if (depth <= 0) return [];

  return [
    run.start,
    run.end,
    { x: run.end.x + inward.x * depth, y: run.end.y + inward.y * depth },
    { x: run.start.x + inward.x * depth, y: run.start.y + inward.y * depth },
  ];
}

/**
 * Which way is into the garden from this run.
 *
 * Probed from the polygon's winding rather than assumed, exactly as `openingNormal` does: a plot
 * drawn clockwise and one drawn anticlockwise have opposite left-hand normals, and a boundary band
 * pushed the wrong way lands entirely outside the plot where nothing clips it and nobody sees the
 * mistake until they wonder why the fence is in the road.
 */
export function inwardNormal(run: BoundaryRun, clockwise: boolean): Point {
  const dx = run.end.x - run.start.x;
  const dy = run.end.y - run.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };

  return clockwise
    ? { x: -dy / length, y: dx / length }
    : { x: dy / length, y: -dx / length };
}

/** True when the ring runs clockwise in this y-down frame. */
export function ringIsClockwise(points: Point[]): boolean {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice > 0;
}

/**
 * Where the posts, piers, balusters or hedge crowns stand along one run.
 *
 * Spaced in **metres and then rounded to a whole count**, so a run always starts with a post and
 * the spacing stretches slightly to fit rather than leaving a stub at the end. Half-open, so a
 * corner post is not drawn twice by the two runs that meet there — the same rule the old single
 * fence renderer kept, and getting it wrong shows as a visibly darker blob at every corner.
 *
 * Returns `[]` when the kind has no posts, or when they would be too close together to resolve —
 * `MIN_POST_SPACING_PX` is the floor, and below it the band alone reads better than a grey haze.
 */
export function runPosts(
  run: BoundaryRun,
  pxPerMetre: number,
  offset: Point,
  /**
   * Metres held back from each end.
   *
   * Zero for a post, which is a thin thing sitting on the line and may stand exactly at a corner.
   * Half its radius for a hedge crown, which is a *disc*: placed at the corner it hangs out past
   * the boundary into the neighbour's garden, and the plan would be showing planting on land the
   * design does not own — the same clamp `borderRegions` applies for the same reason.
   */
  inset = 0,
): Point[] {
  const spacing = BOUNDARY_PALETTE[run.kind].postSpacing;
  if (spacing === null) return [];
  if (spacing * pxPerMetre < MIN_POST_SPACING_PX) return [];

  const usable = run.length - inset * 2;
  if (usable <= 0) return [];

  const count = Math.max(1, Math.round(usable / spacing));
  const posts: Point[] = [];
  const ux = (run.end.x - run.start.x) / run.length;
  const uy = (run.end.y - run.start.y) / run.length;

  /*
   * Inclusive of both ends when inset, half-open when not. A run of posts must not draw one at
   * each corner twice — the two runs meeting there would stack them — but a run of hedge crowns
   * held back from the corners has no such overlap, and stopping short of its own end would leave
   * a visible notch in the hedge at every corner of the garden.
   */
  const steps = inset > 0 ? count : count - 1;

  for (let step = 0; step <= steps; step += 1) {
    const along = inset + (usable * step) / count;
    posts.push({ x: run.start.x + ux * along + offset.x, y: run.start.y + uy * along + offset.y });
  }

  return posts;
}

/** How far a hedge's crowns are held back from each end of a run — half a crown. */
export function crownInset(run: BoundaryRun): number {
  return run.kind === 'hedge' ? run.thickness / 2 : 0;
}

/**
 * Whether this run is broken by a gate at this point.
 *
 * Gates already resolve to segments through `gates.ts`; this is only the "is this post inside one"
 * test, kept here so both renderers ask it the same way. A post standing in a gateway is the
 * single most obvious way a drawn boundary gives itself away as generated.
 */
export function inGap(point: Point, gaps: [Point, Point][]): boolean {
  return gaps.some(([a, b]) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) return false;
    const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length);
    return t > 0 && t < 1;
  });
}
