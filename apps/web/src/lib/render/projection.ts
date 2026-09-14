import { boundingBox, type Point } from '@garden-studio/schema';
import { CAMERA_TILT_DEGREES, RISE } from './camera';

/**
 * The one camera: how a height becomes a picture.
 *
 * ## What this is
 *
 * Visualise draws an **oblique elevated projection**. The ground plane stays exactly what it is in
 * plan — unforeshortened, measurable, every footprint its true shape — and the only thing height
 * does is move a point *up the screen*:
 *
 * ```
 * a point h metres above the ground is drawn at  (x, y − h × RISE)
 * ```
 *
 * That is the whole of it. There is no camera position, no vanishing point, no depth buffer and no
 * perspective divide. A vertical edge stays vertical and stays the same length wherever it is on
 * the plot, so two sheds of the same height show the same face whether they stand at the top of the
 * drawing or the bottom.
 *
 * ## Why oblique rather than isometric or perspective
 *
 * Because a plan has to stay a plan. The brief is explicit that the drawing is "still fundamentally
 * a 2D structured plan" and that the assets must not be "strongly isometric" or look like a game.
 * Isometric rotates the ground plane, which destroys the one property the whole application rests
 * on: that what you see is the footprint the validator measured. Perspective is worse still — a
 * footprint becomes a trapezium that no rectangle can hold, and every placement, selection and
 * dimension in the editor would need a second coordinate system to answer in.
 *
 * Oblique gives up nothing. `geometryOutline` is still what is drawn on the ground; height is an
 * offset applied on top of it, and switching the view off removes the offset and leaves the plan.
 *
 * ## Why 12°, and why it is a constant rather than a setting
 *
 * Twelve degrees is shallow enough that the plan still reads — a 6 m house lifts 1.3 m up the
 * screen, about a seventh of its own depth — and steep enough that everything the brief asks to see
 * is visible: a 1.8 m fence shows a 38 cm face, a 2.3 m shed shows 49 cm of front wall, a 0.45 m
 * raised bed shows 10 cm of sleeper. Past about 20° the faces start hiding the ground behind them
 * and the drawing tips over into a model village.
 *
 * It is a constant and not a control because **the generated assets are drawn at this angle**. The
 * elevated sprite library is photographed from a camera tilted twelve degrees (see
 * `docs/visualise-asset-style.md` and the `ELEVATED` prompt in `asset-spec.ts`), so a slider here
 * would put the drawn geometry at an angle the photographs do not share, and a shed would stand at
 * a different attitude from the sofa beside it. One number, two places, and they are the same fact.
 *
 * ## What this module has no opinion about
 *
 * It does not know what a shed is, does not read a `DesignElement`, and returns no colours. It is
 * given an outline in world metres, a height in metres and the scene's light, and it answers with
 * more world metres. Nothing here is authoritative about anything: every outline it is handed came
 * from `geometryOutline`, every height from `heightFor`, and deleting the file would leave the plan
 * dimensionally identical and merely flat.
 */

/*
 * The angle itself lives in `camera.ts`, which imports nothing — `asset-spec.ts` needs it too and
 * is read by `tools/assets`, a package that cannot resolve the schema. Re-exported here so the rest
 * of the renderer only ever has to know about the projection.
 */
export { CAMERA_TILT_DEGREES, RISE };

/** A point at height `h`, in world metres. `h = 0` is the identity. */
export function lift(point: Point, height: number): Point {
  return { x: point.x, y: point.y - height * RISE };
}

/** A whole ring at height `h`: a rigid translation, so the top of a prism is its own footprint. */
export function liftRing(ring: Point[], height: number): Point[] {
  if (height === 0) return ring.map((point) => ({ ...point }));
  const dy = height * RISE;
  return ring.map((point) => ({ x: point.x, y: point.y - dy }));
}

/**
 * One visible vertical face.
 *
 * `quad` is in world metres and is wound footprint-start → footprint-end → lifted-end →
 * lifted-start, so a painter can fill it without thinking about winding. `lit` is the face's own
 * normal against the scene light: +1 square into the sun, −1 square away, and the painter decides
 * what that is worth in brightness.
 */
export interface ExtrudedFace {
  /** Metres along the original unsplit face, for continuous skin sampling. */
  skinOffset?: number;
  quad: Point[];
  /** Outward unit normal on the ground plane. */
  normal: Point;
  /** `normal · light`, −1…1. */
  lit: number;
  /** The face's own footprint edge, kept so a painter can put a skin on it the right way up. */
  base: [Point, Point];
  /** Metres along the ground — how wide the skin has to tile. */
  length: number;
}

/**
 * A thing with height, resolved into what is actually drawn.
 *
 * The pieces are deliberately separate rather than unioned: a union needs a polygon-boolean library
 * and every consumer here has a better one — a canvas fills the pieces in order and gets the union
 * for free. The same reasoning `projectShadow` already uses for shadow geometry.
 */
export interface Extrusion {
  /** The geometry of record, untouched. What the thing covers on the ground. */
  footprint: Point[];
  /** The footprint lifted to `height`. */
  top: Point[];
  /**
   * The faces the camera can see, **far to near**.
   *
   * Sorted by the footprint edge's own furthest-down-screen point, so a painter that fills them in
   * order gets a correct picture even on a concave outline where a near limb's face overlaps a far
   * one's. The top is drawn after all of them for the same reason and by the same rule: its source
   * geometry is the whole footprint, so it is the nearest piece there is.
   */
  faces: ExtrudedFace[];
  height: number;
}

/**
 * Which way is out of an edge, given the ring's winding.
 *
 * Probed rather than assumed. `rectToPolygon` runs one way and a hand-drawn outline may run the
 * other; an outward normal that is silently inward would put every visible face on the wrong side
 * of the building and nothing downstream checks that a derived direction points somewhere sensible.
 * Exactly the rule `openingNormal` follows, and for exactly the same reason.
 */
function signedArea(ring: Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    twice += current.x * next.y - next.x * current.y;
  }
  return twice / 2;
}

/**
 * Raise an outline into the faces and top a plan actually draws.
 *
 * A face is visible when its outward normal points **down the screen** (+y), because that is the
 * way the camera is tilted: you can see the front of a shed and not its back. A face exactly edge-on
 * — a wall running straight up and down the screen — has a normal with no y component at all and is
 * correctly dropped rather than drawn as a zero-width sliver.
 *
 * Returns an extrusion with no faces for a height of zero, which is a real answer and not a
 * degenerate one: a terrace on grade is a surface, and a surface has no sides.
 */
/** One edge of a ring that the camera can see the outside of. */
export interface VisibleEdge {
  start: Point;
  end: Point;
  /** Outward unit normal on the ground plane; `y` is always positive. */
  normal: Point;
  length: number;
}

/**
 * The edges of a ring whose outside faces the viewer.
 *
 * The single rule the whole projection turns on, extracted because more than one thing needs it:
 * the walls that get drawn, and the strip of shade an oversailing roof throws on them. Both have to
 * agree about which side of a building is the front, and a second copy of the winding probe is
 * exactly how they would come to disagree.
 *
 * An edge running straight up and down the screen has a normal with no `y` component and is
 * dropped. That is not a gap: it is genuinely edge-on to a lift that goes straight up, and drawing
 * it would be a zero-width sliver.
 */
export function visibleEdges(ring: Point[]): VisibleEdge[] {
  if (ring.length < 3) return [];

  /* Clockwise in this y-down frame has positive signed area; the outward normal of an edge running
   * (start → end) is then (dy, −dx) normalised. Flipped for the other winding. */
  const outward = signedArea(ring) > 0 ? 1 : -1;
  const edges: VisibleEdge[] = [];

  for (let i = 0; i < ring.length; i += 1) {
    const start = ring[i]!;
    const end = ring[(i + 1) % ring.length]!;

    const ex = end.x - start.x;
    const ey = end.y - start.y;
    const length = Math.hypot(ex, ey);
    if (length === 0) continue;

    const normal = { x: (ey / length) * outward, y: (-ex / length) * outward };
    if (normal.y <= 0) continue;

    edges.push({ start: { ...start }, end: { ...end }, normal, length });
  }

  /* Far to near: a painter filling these in order needs no depth test, and on a concave outline
   * that is the difference between a correct drawing and a limb showing through another one. */
  return edges.sort((a, b) => Math.max(a.start.y, a.end.y) - Math.max(b.start.y, b.end.y));
}

export function extrude(outline: Point[], height: number, light: Point): Extrusion {
  const footprint = outline.map((point) => ({ ...point }));
  const top = liftRing(outline, height);

  if (outline.length < 3 || height <= 0) {
    return { footprint, top, faces: [], height: Math.max(0, height) };
  }

  const dy = height * RISE;

  const faces = visibleEdges(outline).map(
    ({ start, end, normal, length }): ExtrudedFace => ({
      quad: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
        { x: end.x, y: end.y - dy },
        { x: start.x, y: start.y - dy },
      ],
      normal,
      lit: normal.x * light.x + normal.y * light.y,
      base: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ],
      length,
    }),
  );

  return { footprint, top, faces, height };
}

/**
 * How much of the drawing a lifted thing actually occupies.
 *
 * **Not its footprint**, and the distinction is the one the brief asks for by name: the logical
 * footprint is what the thing covers on the ground and what every measurement, validation and
 * schedule line is about; the visual bounds are what has to be repainted, cached and depth-sorted.
 * A 7 m tree's canopy reaches a metre and a half up the screen past the ground it stands on.
 *
 * Nothing may feed this back into `houseFitsInside`, `geometryIsLegal` or `quantities.ts`. A house
 * that fits would be refused for the roof the renderer drew on it.
 */
export function visualBounds(
  footprint: Point[],
  height: number,
): { minX: number; minY: number; width: number; length: number } {
  return boundingBox([...footprint, ...liftRing(footprint, Math.max(0, height))]);
}

/**
 * Where a thing sorts in the stack, given what it stands on.
 *
 * The **footprint's** furthest-down-screen point, never the visual bounds': what decides whether a
 * tree is in front of a shed is where the two stand, not how tall they are. Sorting by the lifted
 * extent would put a tall thing behind a short one standing in front of it, which is the classic
 * way an oblique drawing goes wrong.
 */
export function depthOf(footprint: Point[]): number {
  let max = -Infinity;
  for (const point of footprint) if (point.y > max) max = point.y;
  return max === -Infinity ? 0 : max;
}
