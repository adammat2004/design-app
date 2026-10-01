import type {
  BoundaryRun,
  DesignElement,
  HouseFootprint,
  Opening,
  Point,
  ShadowCast,
  ShadowOccluder,
} from '@garden-studio/schema';
import type { AssetId } from '../materials/assets/asset-spec';
import type { SurfaceLayer } from '../materials/layers';
import type { MaterialManifestEntry } from '../materials/palette';
import type { ElementPass } from '../materials/scene-passes';
import type { PatternAnchor } from '../materials/render-surface-pattern';
import type { RenderRoof } from './roof';
import type { RenderPasses, RendererVersion } from './primitives';
import type { PlantCluster } from './plant-clusters';

/**
 * The presentation scene: what the plan *looks like*, resolved once, drawn by anything.
 *
 * ## Why this exists
 *
 * There were two drawings of the same garden. `ElementDrawing.tsx` builds a tree of Konva nodes
 * for the editor and the concept cards; `drawPlan` paints the same picture into a 2D context for
 * thumbnails, the PNG export and the judging sheets. They share the geometry helpers and the
 * surface painter, but not the decisions *between* them — which is how one of them came to draw
 * house openings and the other not to, and it is the same class of drift that once had step 4
 * contradicting step 5.
 *
 * `buildRenderScene` is the answer: every decision that is about the picture rather than about
 * the paint is made once, here, and the backends are reduced to putting down pixels. A backend
 * that has to *decide* something is a backend that can disagree with the other one.
 *
 * ## What it is not
 *
 * It has **no authority**. Every outline on it came from `geometryOutline`, every area from
 * `elementArea`, every height from `heightFor`. Nothing downstream reads it, nothing is stored
 * from it, and deleting the whole directory would leave the plan dimensionally identical and
 * merely plainer. The presentation data here — an asset variant, a rotation — is
 * derived afresh on every build and deliberately never reaches `PlanDocument`.
 *
 * The one field that legitimately travels the other way is `DesignElement.pattern`, which was
 * already on the document before this existed and for the same stated reason: which way the
 * decking boards run is a design decision the user made, so it has to survive a reload.
 *
 * ## Determinism
 *
 * The build is a pure function of `(PlanScene, SceneOptions)`. Every random choice comes from
 * `moduleRandom`, whose rule is that **coordinates go into the seed, never into the sequence** —
 * so a plant, a slab tone or a canopy variant is a function of where it is, not of how many
 * things were drawn before it. Editing one bed cannot reshuffle another, and there is a test
 * saying so.
 */
export interface RenderScene {
  rendererVersion: RendererVersion;
  passes: RenderPasses;
  clusters: PlantCluster[];
  /** Hash of pixel dependencies, excluding camera, selection and diagnostics. */
  revision: string;
  boundary: Point[];
  /** The plot's extent in world metres — what a caller sizes its canvas from. */
  bounds: { minX: number; minY: number; width: number; length: number };
  /** Drawn first, below the cast-shadow layer: the ground the garden is laid on. */
  ground: RenderItem[];
  /** Drawn after the cast-shadow layer: the things that stand up off it. */
  objects: RenderItem[];
  /**
   * Render-only vegetation, composited above the ground with real overlap.
   *
   * Empty under `plantingMode: 'baked'`, where planting is painted inside each bed's own raster
   * exactly as it always was. See `SceneOptions.plantingMode` for why there are two answers.
   */
  plants: RenderPlant[];
  house: RenderHouse | null;
  /** What casts a solar shadow, and how. `cast` is null when the plan makes no solar claim. */
  shadows: { cast: ShadowCast | null; occluders: ShadowOccluder[]; sourceIds: string[] };
  /** Unit vector *towards* the light. The real sun when there is one, the drawing light otherwise. */
  light: Point;
  /**
   * How dark it is: 0 in daylight, 1 after civil twilight, `null` when the plan makes no solar
   * claim at all. Straight from `nightFraction`, and null for the reason `shadows.cast` is.
   */
  night: number | null;
  /**
   * The fittings that are lit, and the pool each one throws.
   *
   * **Empty by day**, and empty for a plan with no location, so a scene that has never mentioned
   * where it is draws exactly what it drew before this existed. A fitting is still drawn as an
   * object in daylight — it is a real thing that is really there — but it throws nothing.
   */
  lights: RenderLight[];
  /**
   * Edging courses, resolved from the hosts they follow rather than stored anywhere.
   *
   * **Only what resolution produced**: a stretch whose treatment is `none` is not here at all, which
   * is what stops a surface with nothing to say drawing an outline round itself.
   *
   * Resolved to `RenderSurface` so the existing painter draws them with no new code path — an
   * edging course is a narrow strip of paving and wants exactly the module, joint and tone
   * treatment a patio gets. The `element` on each is **synthetic** and never leaves this layer:
   * `plan/edges/resolve.ts` returns geometry, and giving it an id and a material here is what lets the
   * surface painter take it. Nothing reads it back, and `quantities.ts` cannot see it.
   */
  edging: RenderSurface[];
  /**
   * The retaining faces of everything that does not sit on grade.
   *
   * Derived from `levelBands`, which is derived from `DesignElement.elevation` — so, like edging,
   * a retaining structure is never a thing anybody places and can never be left behind when the
   * terrace it holds up is moved. Empty for a plan where everything is on one level, which is most
   * plans and every plan that existed before this.
   */
  levels: RenderLevel[];
  /** The survey's sides as the design leaves them, then the proposed fences, walls and screens. */
  boundaryRuns: BoundaryRun[];
  /** The survey's stretches a proposal replaces: drawn faintly under the new, never cast or counted. */
  replacedRuns: BoundaryRun[];
  /**
   * The instanced plants, one node each, in the order the standing pass draws them.
   *
   * The v2 renderer draws standing things from here rather than from `plants`, so the plan's
   * planting under Pixi and in the composer come from one list. It held a whole depth-sorted
   * elevated drawing — extruded sheds, a lifted house, fences with faces — while the Visualise
   * view existed; that view was retired in Sep 2026 and plants are all that is left in it.
   */
  stack: RenderNode[];
}

/** One thing in the standing stack: today, always a plant. */
export type RenderNode = RenderPlantNode;

interface RenderNodeBase {
  /**
   * Stable across builds, and the tiebreak that makes the sort total.
   *
   * Without it two things standing on exactly the same line — the commonest case there is, since
   * the generator aligns everything — would sort by whichever order they happened to be built in,
   * and a plan would draw differently for no visible reason.
   */
  id: string;
  /**
   * Where the thing stands — a plant's own stem, `at.y` — never its visual extent: what decides
   * which of two plants is drawn over the other is where they stand, not how far the crowns reach.
   */
  depth: number;
  /**
   * How much of the drawing this covers, in world metres: the footprint **and** the height above
   * it, with a margin for the contact shadow.
   *
   * The brief's logical-footprint-versus-visual-bounds distinction, made concrete. The footprint is
   * what every measurement, validation and schedule line is about; this is what has to be
   * repainted, cached and uploaded as a texture, and it is bigger — a seven-metre tree reaches a
   * metre and a half up the screen past the ground it stands on.
   *
   * Resolved here rather than in the backends because Pixi sizes a per-node raster from it: a box
   * the two backends worked out separately would be the one thing about the picture that could
   * differ between them without any test being able to see it.
   */
  bounds: { minX: number; minY: number; width: number; length: number };
  visualLayer: VisualLayer;
}

/** One instanced plant, standing at a point. */
export interface RenderPlantNode extends RenderNodeBase {
  kind: 'plant';
  plant: RenderPlant;
}

/**
 * One lit fitting, resolved to the pool it throws rather than to the object that throws it.
 *
 * The fitting itself is an ordinary `RenderItem` in `objects` and draws as its sprite; this is the
 * *light*, which is a separate thing with a separate size. That split is the whole reason a
 * 120 mm spike light works on a plan at all: the fitting is a dot four pixels across and the pool
 * it casts is three metres, and it is the pool a reader sees.
 */
export interface RenderLight {
  /** The element's own id, so a backend can key on it. */
  id: string;
  /** World metres — the fitting's own anchor. */
  at: Point;
  /** Radius of the pool on the ground, world metres. */
  radius: number;
  /** 0-1. The fitting's own output scaled by how dark it is, so dusk comes up gradually. */
  intensity: number;
}

/**
 * One retaining face, resolved to the band a plan actually draws.
 *
 * The strip **straddles** the host's edge rather than sitting outside it, which is where a
 * retaining wall really is: the terrace above bears on it, so its thickness is half under the
 * paving and half proud of it. That also means a raised element's drawn extent is its real extent —
 * nothing grows a margin it did not have, so `houseFitsInside` and the validator still measure the
 * same shape they always did.
 */
export interface RenderLevel {
  hostId: string;
  /** The tessellated band, world metres. */
  outline: Point[];
  /** Metres of exposed face. */
  rise: number;
  sunken: boolean;
  /**
   * The painter's arguments when a walling material was chosen, else `null`.
   *
   * Two answers rather than one, because they are two different drawings and both are truthful. A
   * wall built of something — coursed stone, brick — has a top course worth painting, and gets the
   * same module treatment a patio does. A terrace retained in its *own* paving has no such course:
   * it is an upstand of the same stuff, and the honest drawing is the host's tone a shade darker.
   */
  surface: RenderSurface | null;
  /** The plain upstand's fill: the host's own material, darkened. Used when `surface` is null. */
  colour: string;
}

/**
 * One thing to draw, with everything the backends would otherwise each work out for themselves.
 *
 * `element` is carried rather than copied: the backends genuinely need its category, symbol and
 * material to choose a drawing, and referencing the document is not the same as duplicating it.
 * What must never happen is the reverse — a field invented here finding its way back onto the
 * document.
 */
export interface RenderItem {
  element: DesignElement;
  /** Which half of a two-pass element this is. A pergola is drawn in both. */
  part: ElementPass;
  /** Resolved painter arguments, when this item paints a surface at all. */
  surface: RenderSurface | null;
  visualLayer: VisualLayer;
}

/** Exactly what `drawSurfacePattern` takes, resolved once instead of per backend. */
export interface RenderSurface {
  elementId: string;
  /** The element this paints. Carried for its category and material, never written back to. */
  element: DesignElement;
  outline: Point[];
  /** A path lays its stepping stones along its own line, not across its bounding box. */
  centreline: Point[] | null;
  /** Null means the material has no pattern half, and the surface is a flat fill. */
  material: MaterialManifestEntry | null;
  /** The stack the surface is made of. One entry for everything that is not a layered bed. */
  layers: SurfaceLayer[];
  anchor: PatternAnchor;
  seed: string;
  /**
   * Rings this surface must not plant inside.
   *
   * `null` is not `[]`: it means this item does not speak for exclusions and the pass's own value
   * stands. Only ground-pass beds compute them, which is what keeps a distant edit out of a
   * bed's raster cache key.
   */
  exclusions: Point[][] | null;
  /**
   * Which segments of `outline` carry the painter's cut edge, decided once for the scene by
   * `cutEdgeMasks` from what lies on the far side of each. `null` means the painter's own default,
   * which is every segment — the answer a synthetic surface (a course, a retaining top) gets.
   */
  cutEdge: boolean[] | null;
  /**
   * How far a course stands proud, in metres, where this surface is an edging run. Carried here
   * rather than looked up again from the product, because a run may override its product's height
   * and a flush join has none. Absent on everything that is not a course.
   */
  height?: number;
}

/**
 * A plant that exists only in the picture.
 *
 * The design's *structural* plants — a specimen tree, a backdrop shrub — are real
 * `DesignElement`s, because they are decisions somebody made and can move. Everything between
 * them is infill: it has no identity worth persisting, it must not become a quantity, and there
 * are hundreds of it. So it is derived here, every render, from the same `samplePlanting` the
 * generator used to place the structural ones — which is why a placed shrub lands exactly where
 * the infill would have drawn one.
 */
export interface RenderPlant {
  /**
   * `bedId:role:col,row` — the plant's identity, and it is stable by construction.
   *
   * Cells are indexed from the **world origin**, so dragging a bed's vertex does not renumber
   * them, and nothing about this id involves how many plants were emitted first.
   */
  id: string;
  /** World metres. */
  at: Point;
  /** Metres across. */
  spread: number;
  /** Metres tall, from the scheme layer's own height band. */
  height: number;
  rotation: number;
  /** Null falls back to the drawn blob, exactly as the painter does when no sprite has loaded. */
  assetId: AssetId | null;
  /** Which catalogue variant of that family, chosen from the placement's own draw. */
  variant: number;
  flower: { assetId: AssetId; scale: number } | null;
  /** Unit interval, indexes the palette for the blob fallback and the sprite tint. */
  tone: number;
  visualLayer: VisualLayer;
  /** The bed this came from. */
  hostId: string;
  /**
   * What the painter draws when no sprite is available.
   *
   * `seed` is the layer's own seed, carried so the backend can rebuild the *same* per-unit
   * generator the surface painter used — the blob's lobe shape has to stay spatially hashed, or
   * a plant changes outline when its neighbours do.
   */
  blob: {
    seed: string;
    lobes: number;
    form: 'blob' | 'tufted' | 'clipped-mass';
    palette: string[];
  };
}

/**
 * The house as a building rather than as a footprint.
 *
 * `outline` is `housePolygon(house)` — the geometry of record, untouched. Everything else is
 * derived here on every build: the wall band, and later the roof. **Nothing in this record may
 * be fed back into `houseFitsInside` or the validator**; a roof overhangs its walls, and a plan
 * that measured the overhang would refuse a house that fits.
 */
export interface RenderHouse {
  outline: Point[];
  /** The floor inside the wall band. Null when the footprint is too small to inset. */
  interior: Point[] | null;
  /** Derived every build, drawn strictly within `outline`. */
  roof: RenderRoof | null;
  /**
   * The doors and windows, resolved to where they actually are.
   *
   * Only those that currently resolve: an opening whose wall a resize has shortened under it is
   * left out here exactly as it is left off the canvas, rather than being drawn hanging off the
   * end of the building. The composer drew none of these at all until now, so a door was visible
   * on screen and absent from every thumbnail, export and judging sheet of the same plan.
   */
  openings: RenderOpening[];
  house: HouseFootprint;
}

/** One opening, resolved: where it is and which way is out through it. */
export interface RenderOpening {
  opening: Opening;
  /** The opening's own two ends along its wall, in world metres. */
  segment: [Point, Point];
  /** Unit vector pointing out of the building. */
  normal: Point;
}

/**
 * Where a thing sits in the visual stack.
 *
 * Named rather than numbered so the ordering lives in one table (`visual-layer.ts`) instead of
 * being spelled out at each comparison. Note that nothing sorts by this yet: the draw order is
 * still `scenePasses`' ground/object split, because changing the order and building the seam in
 * the same step would make a pixel diff impossible to attribute.
 */
export type VisualLayer =
  | 'base'
  | 'surface'
  | 'groundcover'
  | 'edge'
  | 'perennial'
  | 'grass'
  | 'furniture'
  | 'structure'
  | 'shrub'
  | 'specimen'
  | 'tree'
  | 'house'
  /**
   * Light fittings, above everything including the house.
   *
   * The top of the stack because a fitting is the smallest object on the plan and the one most
   * easily lost: a spike light is 120 mm, so a canopy drawn over it hides it completely — and the
   * spike lights that matter most are precisely the ones uplighting a tree. A wall light is on the
   * house for the same reason.
   */
  | 'lighting';

export interface SceneOptions {
  rendererVersion: RendererVersion;
  /**
   * Whether the plan draws cast shadows at all. A view preference beside the grid.
   *
   * On by default, because a garden whose objects are not attached to the ground reads as a
   * diagram. Off is a real thing to want: a printed drawing somebody is going to measure or write
   * on wants no shade across it, and so does anyone comparing two layouts rather than looking at
   * one. It turns off the *cast* layer only — the contact disc under a sprite and the shade band
   * along a fence stay, because those say "this stands up" rather than "the sun is over there".
   */
  shadows: boolean;
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  rendererVersion: 'v2',
  shadows: true,
};
