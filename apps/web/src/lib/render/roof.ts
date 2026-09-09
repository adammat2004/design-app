import { boundingBox, insetPolygon, type Point } from '@garden-studio/schema';

/**
 * A plausible roof over the mapped footprint.
 *
 * ## What this is for, and what it must not do
 *
 * The house is context, not subject. A garden plan needs the building to read as a building —
 * otherwise the eye parses a flat grey rectangle as another paved surface and the whole drawing
 * loses its anchor — but it does not need the *actual* house, and nothing here pretends to
 * reconstruct one. There is no roof pitch, storey count or roof form anywhere in `PlanDocument`,
 * deliberately (`HOUSE_HEIGHT` is a flat six metres and says why), so this is inferred from the
 * footprint alone and inferred afresh on every render.
 *
 * **The footprint is untouched.** The roof is drawn *within* `housePolygon(house)`, never outside
 * it — which is why there is no eaves overhang here. An overhang would look slightly better and
 * would put drawn geometry outside the outline that `houseFitsInside` and the validator measure,
 * and a presentation flourish that can make a legal house look illegal is not worth a millimetre
 * of shading. The prompt's rule, kept literally: do not modify measurement geometry to make the
 * roof look good.
 *
 * ## How the shape is derived
 *
 * A hipped roof is exactly the footprint and its own inset: every eaves edge rises to the
 * corresponding edge of the polygon inset by half the building's span, and the planes are the
 * quads between them. `insetPolygon` already does that offset-and-intersect correctly for either
 * winding, keeps a rectangle a rectangle and an L an L, and — the part that matters — returns
 * `null` rather than a guess when the outline is too small to hold the inset. So the degenerate
 * case answers itself: no ridge means a flat roof, which is a real roof and an honest one.
 *
 * A gable is the same construction with the ridge collapsed onto one axis instead of two, which
 * is why a long narrow building gets one: a hipped roof on a 3 m wide terrace is four slivers.
 */
export type RoofForm = 'gable' | 'hipped' | 'flat';

/**
 * The covering. A single restrained default, with the other two named.
 *
 * Nothing in the plan says what the roof is made of, and unlike the *shape* — which the footprint
 * genuinely constrains — the material is not derivable from anything: a guess would be inventing
 * a fact about somebody's house, which is the trap `site.location` exists to avoid. Slate is the
 * default because a dark neutral recedes, and a garden drawing wants the house to sit back.
 */
export type RoofMaterial = 'slate' | 'dark-tile' | 'red-tile';

export const DEFAULT_ROOF_MATERIAL: RoofMaterial = 'slate';

export const ROOF_TONES: Record<RoofMaterial, { base: string; ridge: string }> = {
  slate: { base: '#5a6169', ridge: '#464c53' },
  'dark-tile': { base: '#5d5550', ridge: '#484240' },
  'red-tile': { base: '#8f5a45', ridge: '#6f4436' },
};

export interface RoofPlane {
  /** The quad from one eaves edge up to its ridge edge, in world metres. */
  outline: Point[];
  /**
   * How square-on to the light this plane is, −1 to 1.
   *
   * The plane's normal points up and away from the ridge, so its horizontal component is the
   * eaves edge's outward normal — which is all that is needed to shade against a plan-space
   * light. Every plane of one roof therefore takes its tone from the *same* vector the slab
   * bevels and the cast shadows use. Two suns in one drawing is the fastest way a render gives
   * itself away.
   */
  lit: number;
}

export interface RenderRoof {
  form: RoofForm;
  material: RoofMaterial;
  planes: RoofPlane[];
  /** The ridge and hips, as lines to draw over the planes. Empty for a flat roof. */
  ridge: [Point, Point][];
}

/**
 * Past this ratio of long side to short, a hipped roof reads as four slivers and the building
 * wants a gable instead. Terraces and narrow extensions land the far side of it; a square
 * detached house lands the near side.
 */
const GABLE_ASPECT = 1.35;

/** Held back off the true half-span so the ridge stays a line rather than collapsing to a point. */
const RIDGE_INSET_RATIO = 0.46;

export function roofFor(outline: Point[], light: Point): RenderRoof | null {
  if (outline.length < 3) return null;

  const box = boundingBox(outline);
  const short = Math.min(box.width, box.length);
  const long = Math.max(box.width, box.length);
  if (short <= 0) return null;

  const ridgeRing = insetPolygon(outline, short * RIDGE_INSET_RATIO);

  /*
   * No ridge means the inset folded through itself — a footprint too small or too awkward to hold
   * one. A flat roof is the right answer rather than a fallback: it is a roof that exists, and a
   * small outrigger or a garage genuinely often has one.
   */
  if (!ridgeRing || ridgeRing.length !== outline.length) {
    return {
      form: 'flat',
      material: DEFAULT_ROOF_MATERIAL,
      planes: [{ outline, lit: 0 }],
      ridge: [],
    };
  }

  const form: RoofForm = long / short >= GABLE_ASPECT ? 'gable' : 'hipped';
  const planes: RoofPlane[] = [];

  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const ridgeA = ridgeRing[i]!;
    const ridgeB = ridgeRing[(i + 1) % ridgeRing.length]!;

    planes.push({ outline: [a, b, ridgeB, ridgeA], lit: litness(a, b, ridgeA, light) });
  }

  /*
   * The apex itself, filled flat.
   *
   * The ridge is held a little short of the true half-span so it stays a line rather than
   * collapsing to a point, which leaves a sliver of polygon at the top that no slope covers. Left
   * unfilled it shows the ground through the middle of the roof as a pale bar — the roof reads as
   * a frame rather than a solid. It takes `lit: 0` because a ridge cap is horizontal: it faces the
   * sky, not the sun.
   */
  planes.push({ outline: ridgeRing, lit: 0 });

  /*
   * The ridge and the hips are the edges of the inset ring — every one of them is where two
   * planes meet. Drawn as lines over the planes rather than as a separate shape, because that is
   * what they are: a crease, not a surface.
   */
  const ridge: [Point, Point][] = ridgeRing.map((point, index) => [
    point,
    ridgeRing[(index + 1) % ridgeRing.length]!,
  ]);

  return { form, material: DEFAULT_ROOF_MATERIAL, planes, ridge };
}

/**
 * How lit one plane is: its outward normal against the light.
 *
 * The normal is taken as the direction from the eaves edge towards *away from* the ridge, found
 * by probing rather than assumed from a winding direction — the same rule `openingNormal`
 * follows, and for the same reason: a hand-drawn outline may run either way, and a normal that is
 * silently inverted lights every roof from the wrong side with nothing downstream to catch it.
 */
function litness(a: Point, b: Point, ridgeA: Point, light: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;

  let normal = { x: -dy / length, y: dx / length };

  // The ridge is inside; the plane faces the other way.
  const towardsRidge = { x: ridgeA.x - a.x, y: ridgeA.y - a.y };
  if (normal.x * towardsRidge.x + normal.y * towardsRidge.y > 0) {
    normal = { x: -normal.x, y: -normal.y };
  }

  return normal.x * light.x + normal.y * light.y;
}
