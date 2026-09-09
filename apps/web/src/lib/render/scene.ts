import type {
  BoundaryRun,
  DesignElement,
  HouseFootprint,
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
  shadows: { cast: ShadowCast | null; occluders: ShadowOccluder[] };
  /** Unit vector *towards* the light. The real sun when there is one, the drawing light otherwise. */
  light: Point;
  maturity: Maturity;
  boundaryRuns: BoundaryRun[];
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
  house: HouseFootprint;
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
  | 'house';

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
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  view: 'plan',
  maturity: 'mature',
};
