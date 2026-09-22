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
import type { Extrusion } from './projection';
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
 * merely plainer. The presentation data here — an asset variant, a rotation, a maturity — is
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
  view: SceneView;
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
   * Edging courses, derived from the hosts they follow rather than stored anywhere.
   *
   * Resolved to `RenderSurface` so the existing painter draws them with no new code path — an
   * edging course is a narrow strip of paving and wants exactly the module, joint and tone
   * treatment a patio gets. The `element` on each is **synthetic** and never leaves this layer:
   * `plan/edging.ts` returns geometry, and giving it an id and a material here is what lets the
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
  maturity: Maturity;
  boundaryRuns: BoundaryRun[];
  /**
   * Everything that stands up off the ground, in the order it is drawn.
   *
   * **Empty in `'plan'`**, where the drawing is the flat diagram it has always been and the
   * ground/object split `scenePasses` produces is the whole of the order. Populated in
   * `'visualise'`, where it replaces that split for everything above the cast-shadow layer.
   *
   * The thing this makes possible is the one the flat view cannot express at all: a tree canopy
   * over a roof, a border disappearing behind the fence in front of it, a bench in front of the
   * shrub it stands against. Until now the house, the fence and every object were drawn on the 2D
   * overlay *above* the WebGL planting, so no overlap in either direction was possible — a shrub
   * could never be in front of anything, and the fence could never be in front of a shrub.
   *
   * See `buildStack` for the sort and why depth beats layer.
   */
  stack: RenderNode[];
}

/**
 * One thing in the depth-sorted stack.
 *
 * A tagged union rather than one shape with optional fields, so a backend's switch is total and a
 * new kind of standing thing is a compile error in every backend rather than a silent omission —
 * the same reason `ElementCategory` is a `Record` everywhere it is consumed.
 */
export type RenderNode = RenderPlantNode | RenderObjectNode | RenderExtrusionNode | RenderHouseNode;

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
   * Where the thing stands: the furthest-down-screen point of its own **footprint**.
   *
   * Never its visual extent. What decides whether a tree is in front of a shed is where the two
   * stand, not how far the canopy reaches up the screen — see `depthOf`.
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
 * Something drawn from a sprite: furniture, a light fitting, a tree, a placed shrub.
 *
 * `height` is what the lift is computed from, resolved here through `heightFor` so the backends do
 * not each answer it — and so the height a thing is *drawn* at is the height it *casts a shadow*
 * from, which is the only way the two can be made to agree.
 */
export interface RenderObjectNode extends RenderNodeBase {
  kind: 'object';
  item: RenderItem;
  height: number;
}

/**
 * Something built, raised from its own outline.
 *
 * The answer to rotation, and the reason there is no photograph of a shed anywhere in the library:
 * a built thing is whatever polygon the placer or the user gave it, at any angle, and the faces the
 * camera can see are recomputed from that polygon every render. A raster would have its visible
 * face and its lit side baked in, so turning it would turn both.
 */
export interface RenderExtrusionNode extends RenderNodeBase {
  kind: 'extrusion';
  extrusion: Extrusion;
  source: ExtrusionSource;
  /** Render-only pieces of an open structure, or one continuous boundary run. */
  contribution?: 'post' | 'beam' | 'boundary-segment';
  parentRun?: BoundaryRun;
}

/**
 * What is being raised, so the painter can choose its materials.
 *
 * The node carries geometry and identity; the paint stays the painter's business. That split is
 * what lets one extrusion painter serve a shed, a fence and a retaining wall without knowing what
 * any of them is.
 */
export type ExtrusionSource =
  | { of: 'element'; element: DesignElement; surface: RenderSurface | null }
  /**
   * `inward` is the run's own unit normal pointing into the plot, resolved here rather than in the
   * painters. It needs the boundary ring's winding, which is a fact about the whole plot rather
   * than about the run — so each backend working it out for itself is the standard way the two come
   * to disagree about which side of the fence the garden is on.
   */
  | { of: 'boundary'; run: BoundaryRun; inward: Point }
  | { of: 'level'; level: RenderLevel }
  /**
   * An edging course, raised by how far the product stands proud of the ground.
   *
   * Small — 50 mm of steel, 200 mm of sleeper — and worth doing anyway: a kerb with no side is a
   * painted stripe, and the one thing a kerb is for is standing slightly proud of what it edges.
   * The `surface` carries the painter's arguments, exactly as it does on the flat pass.
   */
  | { of: 'edging'; surface: RenderSurface; height: number };

/** The building, its walls raised to the eaves and its roof sitting on top of them. */
export interface RenderHouseNode extends RenderNodeBase {
  kind: 'house';
  house: RenderHouse;
  /** The outline raised to eaves height. The roof on `house.roof` is drawn on its top ring. */
  walls: Extrusion;
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
  /** Metres across, after maturity has scaled it. */
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
  /** Derived every build, and only in `'visualise'`; the plan drawing keeps the flat diagram. */
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
 * How grown-in the planting is drawn.
 *
 * Presentation only, and deliberately not a planting schedule: it scales how big a crown is
 * drawn and how much of the bed is covered, not what was specified or what anything costs.
 */
export type Maturity = 'year-1' | 'year-3' | 'mature';

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

/**
 * Which of the two views is being drawn.
 *
 * One axis, not several, because every difference between the views moves together and a plan
 * that could be half-visualised is a state nobody wants. Prompt §12 is explicit that the two
 * should differ: 2D Plan prioritises editability and clarity, Visualise prioritises presentation.
 * They are two views over the same plan, and switching between them changes nothing about the
 * design itself.
 *
 * - `'plan'` — planting is painted into each bed's raster, cached per surface per zoom bucket,
 *   where it cannot interfere with selection or hit-testing; the house is the wall-and-floor
 *   diagram step 1 draws. This is what the plan has always looked like.
 * - `'visualise'` — surfaces draw their ground only and the planting becomes `RenderPlant[]`
 *   above them, free to overlap its bed's edge, its neighbours and the lawn beside it; the house
 *   gets a roof. That overlap is the point: a bed clipped to its own outline reads as a cut-out,
 *   which is the single largest reason the plan drawing looks diagrammatic.
 */
export type SceneView = 'plan' | 'visualise';

export interface SceneOptions {
  view: SceneView;
  maturity: Maturity;
  rendererVersion: RendererVersion;
  /** Prototype switch; whole-run ordering remains available for seam comparisons. */
  depthFragments: boolean;
  /**
   * Whether the plan draws cast shadows at all. A view preference beside `maturity`.
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
  view: 'plan',
  maturity: 'mature',
  rendererVersion: 'v2',
  // Long-run fragmentation remains a lab prototype until crossing/seam gates are signed off.
  depthFragments: false,
  shadows: true,
};
