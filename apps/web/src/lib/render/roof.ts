import {
  DEFAULT_ROOF_MATERIAL,
  boundingBox,
  insetPolygon,
  outsetPolygon,
  polygonArea,
  type Point,
  type RoofMaterial,
} from '@garden-studio/schema';

/**
 * A plausible roof over the mapped footprint.
 *
 * ## What this is for, and what it must not do
 *
 * The house is context, not subject. A garden plan needs the building to read as a building —
 * otherwise the eye parses a flat grey rectangle as another paved surface and the whole drawing
 * loses its anchor — but it does not need the *actual* house, and nothing here pretends to
 * reconstruct one. There is no roof pitch or roof form anywhere in `PlanDocument`, so this is
 * inferred from the footprint alone and inferred afresh on every render.
 *
 * **`house.storeys` is deliberately not read here**, though it exists now and `houseHeight` turns
 * it into an eaves line for the shadow pass. A roof seen from directly above covers exactly the
 * same ground whether the house below it is one storey or three: height changes how far the
 * *shadow* falls, which is `shadowOccluders`' business, and would change a perspective view, which
 * this is not. Taking the storey count as an input here would be a dependency that changes no
 * pixel — and one a later reader would reasonably assume must matter.
 *
 * **The footprint is untouched**, and that rule has survived the arrival of an eaves overhang
 * rather than being weakened by it. `overhang` defaults to zero, so the plan drawing is still the
 * roof drawn *within* `housePolygon(house)` — where an oversail would put drawn geometry outside
 * the outline `houseFitsInside` measures, and a presentation flourish that can make a legal house
 * look illegal is not worth a millimetre of shading. Visualise passes `EAVES_OVERHANG`, where the
 * roof is already drawn a metre and a quarter up the screen and the question is no longer whether
 * drawn geometry may leave the outline but whether the building reads as one. See `EAVES_OVERHANG`.
 * The prompt's rule is kept either way: do not modify *measurement* geometry to make the roof look
 * good, and nothing here does.
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
 * Unlike the *shape* — which the footprint genuinely constrains — the material is not derivable
 * from anything, so it is **asked** rather than guessed: `HouseFootprint.roofMaterial`, defaulted to
 * slate because a dark neutral recedes and a garden drawing wants the house to sit back. The type
 * lives in the schema so the document and the painter cannot hold two different lists.
 */
export type { RoofMaterial };
export { DEFAULT_ROOF_MATERIAL };

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
  /**
   * The roof's own outer edge — the walls grown by the overhang, or the walls themselves when
   * there is none.
   *
   * Carried rather than left to the painter to reassemble from the planes. The planes tile this
   * ring, so it *could* be recovered from them, and a painter doing that would be rebuilding
   * something the builder already had — and would get it wrong the first time a roof form had
   * planes that meet somewhere other than a ridge.
   */
  eaves: Point[];
  /**
   * Rooflights, as rings on the planes they sit in. Empty on a small or flat roof.
   *
   * A house of any size has something in its roof — a conservation light over a stair, a dormer,
   * a flue — and a slope that is one unbroken field of tile is the most obvious way a drawn roof
   * reads as a texture swatch rather than as a building. It is a **drawing convention** in the
   * contact-shadow class rather than a claim: the document does not know whether this house has
   * one, and one small rectangle on a large plane says "this is a roof" without saying anything
   * about the room underneath.
   */
  rooflights: Point[][];
}

/**
 * How big a plane has to be before it carries a rooflight, in square metres.
 *
 * Large enough that only a real slope gets one: a hip end on an ordinary house is well under it,
 * and so is every plane of a small outrigger, so the convention shows up where a roof is broad
 * enough for the eye to want something on it and nowhere else.
 */
const ROOFLIGHT_MIN_PLANE = 30;

/** A rooflight's own size, in metres. A conservation light is about this. */
const ROOFLIGHT = { along: 1.1, up: 0.8 };

/**
 * One light per plane big enough to carry it, centred on the plane and square to its eaves.
 *
 * Square to the eaves rather than to the world, so a rotated house's rooflights turn with it — the
 * same reason the slate courses follow the eaves edge rather than the screen.
 */
function rooflightsFor(planes: RoofPlane[]): Point[][] {
  const lights: Point[][] = [];

  for (const plane of planes) {
    if (plane.outline.length < 4) continue;
    if (polygonArea(plane.outline) < ROOFLIGHT_MIN_PLANE) continue;

    const [a, b] = plane.outline as [Point, Point];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    if (run <= 0) continue;

    const along = { x: (b.x - a.x) / run, y: (b.y - a.y) / run };
    const up = { x: -along.y, y: along.x };

    /* The centre of the plane, and the direction from the eaves towards the ridge. */
    const centre = plane.outline.reduce(
      (total, point) => ({
        x: total.x + point.x / plane.outline.length,
        y: total.y + point.y / plane.outline.length,
      }),
      { x: 0, y: 0 },
    );

    const half = { along: ROOFLIGHT.along / 2, up: ROOFLIGHT.up / 2 };
    lights.push(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([u, v]) => ({
        x: centre.x + along.x * u! * half.along + up.x * v! * half.up,
        y: centre.y + along.y * u! * half.along + up.y * v! * half.up,
      })),
    );
  }

  return lights;
}

/**
 * Past this ratio of long side to short, a hipped roof reads as four slivers and the building
 * wants a gable instead. Terraces and narrow extensions land the far side of it; a square
 * detached house lands the near side.
 */
const GABLE_ASPECT = 1.35;

/** Held back off the true half-span so the ridge stays a line rather than collapsing to a point. */
const RIDGE_INSET_RATIO = 0.46;

/**
 * How far a roof oversails its own walls, in metres. Visualise only.
 *
 * ## Why this exists now, when it was deliberately refused before
 *
 * The original note stands on its own terms: in the **plan** drawing the roof *is* the house's
 * drawn extent, so an overhang would put geometry outside the outline `houseFitsInside` measures,
 * and a presentation flourish that can make a legal house look illegal is not worth a millimetre of
 * shading. None of that has changed and the plan view still gets `overhang: 0`.
 *
 * What changed is the elevated view, where the roof is already drawn 1.27 m up the screen from the
 * footprint — far further than any eaves. The question there is not whether drawn geometry may
 * leave the outline, which it already does by a factor of four, but whether the building reads as a
 * building. A roof flush with its walls reads as an extruded block; an oversailing one reads as a
 * roof, and it is the single clearest difference between the reference photograph and what we draw.
 *
 * 0.35 m is a real domestic eaves projection. **Nothing derived from it may reach validation**, and
 * nothing can: it is applied inside `roofFor` in the visualise branch and never touches
 * `housePolygon`, which is what every measurement still reads.
 */
export const EAVES_OVERHANG = 0.35;

export interface RoofOptions {
  /** How far the roof oversails its walls. Zero in the plan view; see `EAVES_OVERHANG`. */
  overhang?: number;
  /** What it is covered with, from the document. */
  material?: RoofMaterial;
}

export function roofFor(walls: Point[], light: Point, options: RoofOptions = {}): RenderRoof | null {
  const overhang = options.overhang ?? 0;
  const material = options.material ?? DEFAULT_ROOF_MATERIAL;
  if (walls.length < 3) return null;

  /*
   * Everything below works on the eaves line rather than on the wall line, so the hips, the ridge
   * and every plane are derived from the roof's real extent. Drawing the roof from the walls and
   * then fattening it afterwards would put the hips where no roof has them.
   *
   * An outset that folds through itself falls back to no overhang rather than to nothing: a roof
   * flush with its walls is a worse drawing, and no roof at all is a hole in the plan.
   */
  const grown = overhang > 0 ? outsetPolygon(walls, overhang) : null;
  const outline = grown && grown.length === walls.length ? grown : walls;

  const rectangular = rectangularRoof(outline, light, material);
  if (rectangular) return rectangular;

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
      material,
      planes: [{ outline, lit: 0 }],
      ridge: [],
      eaves: outline,
      rooflights: [],
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

  return { form, material, planes, ridge, eaves: outline, rooflights: rooflightsFor(planes) };
}

/** Orthogonal footprints get a real ridge in the building's frame, including rotated houses. */
function rectangularRoof(outline: Point[], light: Point, material: RoofMaterial): RenderRoof | null {
  if (outline.length !== 4) return null;
  const [a, b, c, d] = outline as [Point, Point, Point, Point];
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ad = { x: d.x - a.x, y: d.y - a.y };
  const w = Math.hypot(ab.x, ab.y);
  const h = Math.hypot(ad.x, ad.y);
  if (
    Math.min(w, h) < 0.3 ||
    Math.abs(ab.x * ad.x + ab.y * ad.y) > w * h * 1e-6 ||
    Math.hypot(c.x - b.x - d.x + a.x, c.y - b.y - d.y + a.y) > 1e-5
  )
    return null;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const u = w >= h ? ab : ad;
  const v = w >= h ? ad : ab;
  const at = (x: number, y: number): Point => ({
    x: a.x + (u.x * x) / long + (v.x * y) / short,
    y: a.y + (u.y * x) / long + (v.y * y) / short,
  });
  const form = long / short >= GABLE_ASPECT ? 'gable' : 'hipped';
  const inset = form === 'gable' ? 0 : short * 0.42;
  const corners = [at(0, 0), at(long, 0), at(long, short), at(0, short)];
  const r0 = at(inset, short / 2);
  const r1 = at(long - inset, short / 2);
  const rings = [
    [corners[0]!, corners[1]!, r1, r0],
    [corners[2]!, corners[3]!, r0, r1],
    ...(form === 'hipped'
      ? [
          [corners[3]!, corners[0]!, r0],
          [corners[1]!, corners[2]!, r1],
        ]
      : []),
  ];
  const planes = rings.map((ring) => ({
    outline: ring,
    lit: litness(ring[0]!, ring[1]!, ring[2]!, light),
  }));
  return {
    form,
    material,
    planes,
    rooflights: rooflightsFor(planes),
    ridge: [
      [r0, r1],
      ...(form === 'hipped'
        ? corners.map((corner, i): [Point, Point] => [corner, i === 0 || i === 3 ? r0 : r1])
        : []),
    ],
    eaves: corners,
  };
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
