import {
  boundaryRuns,
  boundingBox,
  cutEdgeMasksFor,
  resolveEdges,
  type EdgeRuleContext,
  type ResolvedEdgeRun,
  elementAnchor,
  edgingHeight,
  heightFor,
  houseHeight,
  levelBands,
  elementCentreline,
  elementOutline,
  housePolygon,
  insetPolygon,
  openingNormal,
  openingSegment,
  isLightSymbol,
  lightDirection,
  nightFraction,
  patternAnchor,
  polylineStrip,
  resolveSymbol,
  shadowOccluders,
  type BoundaryRun,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { resolveLayers } from '../materials/layers';
import { LIGHT_DIRECTION, presentationCast } from '../materials/light';
import { materialFill } from '../material-colours';
import { cssToRgb, rgbToCss, shiftBrightness } from '../materials/light';
import { resolvePattern } from '../materials/palette';
import { plantingExclusions, scenePasses } from '../materials/scene-passes';
import { boundaryBand, inwardNormal, ringIsClockwise } from '../materials/symbols/boundary';
import { drawnLift } from '../materials/symbols/elevated';
import { WALL_THICKNESS } from '../materials/symbols/property';
import { buildPlants } from './plants';
import { EAVES_OVERHANG, roofFor } from './roof';
import { depthOf, extrude, visualBounds } from './projection';
import {
  DEFAULT_SCENE_OPTIONS,
  type RenderHouse,
  type RenderItem,
  type RenderLevel,
  type RenderLight,
  type RenderNode,
  type RenderOpening,
  type RenderPlant,
  type RenderScene,
  type RenderSurface,
  type SceneOptions,
} from './scene';
import { LAYER_ORDER, layerForElement } from './visual-layer';
import { compilePrimitives } from './primitives';
import { clockNow, recordCompilation } from './diagnostics';

/** What is drawn. The same subset of the document every canvas already works from. */
export interface PlanScene {
  boundary: Point[];
  house: HouseFootprint | null;
  elements: DesignElement[];
  /** Read for its sun and its boundary styling. `location: null` means no solar claim is made. */
  site: SiteSection;
  /**
   * The brief's style, budget and upkeep, which decide what automatic edging lays.
   *
   * Optional, because a scene with none still has an honest answer: the rules fall back to what
   * each surface's own `edging` product says, and to nothing where it says nothing.
   */
  edgeRules?: EdgeRuleContext;
}

export interface BuildOptions extends Partial<SceneOptions> {
  /**
   * Overrides the light the site would give.
   *
   * The judging sheets render one plan at four times of day, so the light cannot simply be a
   * function of the stored `site` — and `drawPlan` has always taken it on the pass. Absent, the
   * site answers: the real sun where the plan knows where on Earth it is, and the conventional
   * top-left drawing light where it does not.
   */
  light?: Point;
}

/**
 * Resolve a plan into everything a renderer needs and nothing it has to decide.
 *
 * Pure, and pure in a way that matters: it touches no canvas, loads no image and reads no React,
 * so the whole of it is testable in Node against plain data. That is deliberate, because this is
 * now where determinism lives. The Pixi backend cannot be pixel-tested headlessly at all, so
 * anything it could get wrong about *what* to draw has to be assertable before a renderer sees
 * it — leaving the backends with nothing to be wrong about except paint.
 */
export function buildRenderScene(scene: PlanScene, options: BuildOptions = {}): RenderScene {
  const started = clockNow();
  const { view, maturity, rendererVersion, depthFragments, shadows } = { ...DEFAULT_SCENE_OPTIONS, ...options };
  const instanced = view === 'visualise';

  const elements = scene.elements.filter((element) => !element.hidden);
  const passes = scenePasses(elements);
  const light = options.light ?? lightDirection(scene.site) ?? LIGHT_DIRECTION;
  /*
   * The sheets override `light` to render one plan at four times of day, and that override must
   * not smuggle in a night: an explicit light means the caller is driving the sun itself, so the
   * honest answer for how dark it is, is "this scene is not making that claim".
   */
  const night = options.light ? null : nightFraction(scene.site);

  const plants: RenderPlant[] = [];

  /*
   * Which sides of each surface are a cut edge, decided once here from the whole element list —
   * the one place that can see what lies on the far side of a seam — and handed to the raster the
   * way the planting exclusions are. A base fill's answer is "none", which is what stops the zone
   * seams drawing across the middle of a gravel garden.
   */
  const edgeResolution = resolveEdges(
    elements,
    { boundary: scene.boundary, house: scene.house ? housePolygon(scene.house) : undefined },
    scene.edgeRules,
  );
  const cutEdges = cutEdgeMasksFor(elements, edgeResolution);

  const ground = passes.ground.map((element): RenderItem => {
    /*
     * Only ground-pass beds compute exclusions, exactly as `drawPlan` has always done. The object
     * pass leaves the field null, which is not the same as empty: null means "this item does not
     * speak for exclusions", so the pass's own value stands and a caller that set one keeps it.
     */
    const exclusions = plantingExclusions(element, elements);
    const surface = resolveSurface(element, exclusions, true, cutEdges.get(element.id) ?? null);

    /*
     * Planting is instanced in **both** views — _this reverses_ "instanced mode" being the Visualise
     * one. A bed painted inside `clip(outline)` is a cut-out by construction: no plant can cross its
     * own edge, nothing spills onto the lawn beside it, and every border on the drawing ends in a
     * hard line no garden has. That clip was the largest single reason the 2D Plan read as a
     * diagram, and it was never what made the plan *measurable* — the outline is still the geometry
     * of record, still what selection, handles, dimensions and the schedule use. Only the picture
     * overhangs, exactly as a tree canopy has always been allowed to.
     *
     * The camera is the thing that must not travel with it. `chooseAsset` resolves a family and
     * then swaps it for its elevated twin, so instancing the plan view without saying which camera
     * it is drawing to is precisely how `vis-*` art once shipped into the 2D Plan. `audit:assets`
     * fails on that now; this passes the answer down rather than leaving it to be inferred.
     *
     * The exclusions travel with them: a structure standing in a bed leaves the same gap in the
     * sprites that it left in the texture.
     */
    if (surface?.material) {
      const stack = resolveLayers(surface.material, element);
      plants.push(
        ...buildPlants(element, stack, surface.outline, exclusions, maturity, instanced ? 'elevated' : 'plan'),
      );
    }

    return { element, part: 'ground', surface, visualLayer: layerForElement(element) };
  });

  const objects = passes.objects.map((element): RenderItem => ({
    element,
    /* A pergola is drawn in both passes: its deck below the shadows, its beams above them. */
    part: element.symbol === 'pergola' ? 'object' : 'all',
    surface: resolveSurface(element, null, instanced, cutEdges.get(element.id) ?? null),
    visualLayer: layerForElement(element),
  }));

  const house = resolveHouse(scene.house, instanced ? light : null, light);
  const runs = boundaryRuns(scene.site);
  const levels = buildLevels(elements, scene);
  const edging = buildEdging(edgeResolution.runs);
  const casters = [
    ...shadowOccluders([], scene.house).map((occluder) => ({ sourceId: 'house', occluder })),
    ...runs.flatMap((run) => shadowOccluders([], null, [run]).map((occluder) => ({ sourceId: `boundary:${run.edgeVertexId}`, occluder }))),
    ...elements.flatMap((element) => shadowOccluders([element], null).map((occluder) => ({ sourceId: element.id, occluder }))),
  ];

  const content = {
    rendererVersion,
    boundary: scene.boundary,
    bounds: boundingBox(scene.boundary),
    ground,
    objects,
    plants,
    house,
    /*
     * The real sun where the plan knows where on Earth it is, the drawing's own light where it
     * does not, nothing where it knows and the sun is down, and nothing at all when the user has
     * turned shadows off.
     *
     * `presentationCast` carries `source: 'conventional'` on the middle case so that everything
     * which would be a claim about this garden at this hour — the time slider, the shadow-hours
     * sheet, the night ramp — can keep refusing to make it. See `light.ts` for why the cast layer
     * was the one drawing convention held to the solar standard, and what that cost the picture.
     */
    shadows: {
      cast: shadows ? presentationCast(scene.site, light) : null,
      occluders: casters.map((caster) => caster.occluder),
      sourceIds: casters.map((caster) => caster.sourceId),
    },
    light,
    night,
    lights: buildLights(elements, night),
    edging,
    levels,
    maturity,
    view,
    boundaryRuns: runs,
    /*
     * The plan's stack holds its **plants and nothing else**.
     *
     * The v2 renderer draws standing things from the stack rather than from `scene.plants`, so a
     * plan view with an empty stack has no planting under Pixi at all — while the composer, which
     * draws `plants` directly, would have it. Giving the plan view a plants-only stack is what
     * keeps those two agreeing. Everything else in a full stack is the *elevated* drawing — lifted
     * extrusions, skinned faces, a roof — and none of it may reach the plan; `buildStack` is not
     * called here, so it cannot arrive by a later edit to a flag.
     */
    stack: instanced
      ? buildStack({ boundary: scene.boundary, objects, plants, house, runs, levels, edging, light })
      : plantNodes(plants),
  };
  const rendered: RenderScene = { ...content, ...compilePrimitives(content, scene.site, depthFragments) };
  recordCompilation(rendered, clockNow() - started);
  return rendered;
}

/**
 * Where lighting sorts: last, outside the depth order entirely.
 *
 * Every other standing thing takes its place from where it stands. A light fitting does not, and
 * the reason is the one already written into `LAYER_ORDER`: a spike light is 120 mm across, and the
 * spike lights that matter most are the ones uplighting a tree — so depth-sorting them honestly
 * would bury every one of them under the thing it lights. A fitting drawn over its own shrub is
 * wrong by a few centimetres; a fitting that cannot be seen at all is wrong by the whole feature.
 */
const DEPTH_SORTED = 0;
const ALWAYS_LAST = 1;

/**
 * How much room a node's bounds leave around its footprint, as a proportion.
 *
 * A sprite is not clipped to the geometry it stands on — a canopy overhangs its trunk, a contact
 * shadow reaches past the thing casting it, a shrub's foliage spills over the bed's edge — and all
 * of that has to be inside the box a backend rasterises. Too small and objects are cropped; too
 * large and every raster is mostly empty. A sixth is what `CONTACT_SHADOW_SCALE` and the canopy
 * offset between them ask for, rounded up.
 */
const NODE_MARGIN = 1.18;

/** The same ring with that margin about its own centre. */
function marginOf(outline: Point[]): Point[] {
  const box = boundingBox(outline);
  const cx = box.minX + box.width / 2;
  const cy = box.minY + box.length / 2;
  return outline.map((point) => ({
    x: cx + (point.x - cx) * NODE_MARGIN,
    y: cy + (point.y - cy) * NODE_MARGIN,
  }));
}

function sortGroup(node: RenderNode): number {
  return node.visualLayer === 'lighting' ? ALWAYS_LAST : DEPTH_SORTED;
}

/**
 * Everything that stands up, in the order a painter with no depth buffer should lay it down.
 *
 * ## The sort, and why depth comes before layer
 *
 * `(group, depth, layer, id)` — and the order of those keys is the whole design.
 *
 * The obvious sort is by layer: ground cover, then perennials, then shrubs, then trees, which is
 * how the flat view has always stacked a bed. In an elevated view that is wrong, and visibly so: it
 * puts every tree in front of every shrub regardless of where the two stand, so a shrub at the
 * front of a border is drawn *behind* a tree at the back of it. The picture reads as a collage.
 *
 * Sorting by where a thing stands — the furthest-down-screen point of its own footprint — is the
 * painter's algorithm, and it is correct for the overwhelming majority of a garden: things nearer
 * the viewer are drawn later and cover what is behind them.
 *
 * Layer is then the **tiebreak**, and it earns its place there. Two things standing on exactly the
 * same line is not a rare case in a generated plan — the grammar aligns everything — and that is
 * precisely where the hierarchy is the right answer: a ground cover and a shrub at the same depth
 * should stack short-then-tall. `id` last makes the sort total, so a plan draws the same way twice.
 *
 * ## What this cannot do
 *
 * A painter's sort on footprints is not a depth buffer, and two objects whose *lifted* extents
 * interleave — a tall tree just behind a low wall — are genuinely ambiguous without one. The answer
 * here is always "the nearer thing's whole drawing wins", which is right far more often than it is
 * wrong and, when it is wrong, is wrong in a way that reads as an object standing slightly further
 * forward than it is. A z-buffer would need real depth per pixel, which needs a real camera, which
 * is the thing this projection exists not to have.
 */
/**
 * One node per plant, which is the whole of the plan view's stack and the start of Visualise's.
 *
 * `visualBounds` lifts the box by half the plant's height because that is what the *drawing* does
 * — the sprite is drawn a little up the screen so a tall thing reads as standing — and the bounds
 * have to cover what is painted or the raster clips it. In the plan view that lift is a couple of
 * pixels; keeping the same function for both is worth more than saving them.
 */
function plantNodes(plants: RenderPlant[]): RenderNode[] {
  return plants.map((plant) => {
    const half = (plant.spread / 2) * NODE_MARGIN;
    return {
      kind: 'plant',
      id: plant.id,
      depth: plant.at.y,
      bounds: visualBounds(
        [
          { x: plant.at.x - half, y: plant.at.y - half },
          { x: plant.at.x + half, y: plant.at.y + half },
        ],
        plant.height / 2,
      ),
      visualLayer: plant.visualLayer,
      plant,
    };
  });
}

function buildStack(scene: {
  boundary: Point[];
  objects: RenderItem[];
  plants: RenderPlant[];
  house: RenderHouse | null;
  runs: BoundaryRun[];
  levels: RenderLevel[];
  edging: RenderSurface[];
  light: Point;
}): RenderNode[] {
  const nodes: RenderNode[] = plantNodes(scene.plants);

  for (const item of scene.objects) {
    const outline = elementOutline(item.element);
    if (outline.length < 3) continue;

    const height = heightFor(item.element) + Math.max(0, item.element.elevation ?? 0);
    const base = {
      id: item.element.id,
      depth: depthOf(outline),
      bounds: visualBounds(marginOf(outline), height),
      visualLayer: item.visualLayer,
    };

    /*
     * Built or photographed, and the line is `isBuilt`. A structure is whatever rectangle it was
     * given, so it is raised from that rectangle; everything else is a thing of a known size that a
     * sprite can be fitted inside, which is what the plan camera has always done and what the
     * elevated library carries on doing from a different angle.
     */
    if (isBuilt(item.element)) {
      nodes.push({
        ...base,
        kind: 'extrusion',
        extrusion: extrude(outline, height, scene.light),
        source: { of: 'element', element: item.element, surface: item.surface },
      });
    } else {
      nodes.push({ ...base, kind: 'object', item, height });
    }
  }

  const clockwise = ringIsClockwise(scene.boundary);

  for (const run of scene.runs) {
    /*
     * A run is raised from the same band the flat view fills — `boundaryBand`, pushed **inward**
     * from the property line, because a fence is built inside the plot it encloses. Raising a strip
     * centred on the line instead would put half of every fence on the neighbour's land and would
     * disagree with what the plan view has always drawn.
     *
     * Skipped when there is nothing to raise: an `open` boundary is a cadastral line rather than a
     * thing, and a zero-height prism for it would put a hairline of wall across a gap the user
     * explicitly said was open.
     */
    if (run.height <= 0 || run.thickness <= 0) continue;

    const inward = inwardNormal(run, clockwise);
    const outline = boundaryBand(run, inward);
    if (outline.length < 3) continue;

    nodes.push({
      kind: 'extrusion',
      id: `boundary:${run.edgeVertexId}`,
      /*
       * **The far end of the run, not the near one** — the only place in the stack that does not
       * use `depthOf`, and it is a consequence of a run being drawn whole.
       *
       * A side fence spans the entire depth of the plot, so its furthest-down-screen point is the
       * bottom corner of the garden. Sorted on that, a side fence draws after everything and lays a
       * line over the border planted against it — which is exactly backwards: the planting is
       * inside the fence and in front of it at every point along it.
       *
       * Taking the furthest point instead says the honest thing about an object that is drawn as
       * one piece: it reaches back to here, so everything nearer than that is in front of it. The
       * near boundary still sorts last, because its whole band is at the bottom of the plot.
       *
       * The exact answer is to split each run into segments and sort each on its own, and it is not
       * worth it: the segments would abut, and a dozen anti-aliased seams down every fence is a
       * worse defect than the one being fixed.
       */
      depth: Math.min(...outline.map((point) => point.y)),
      bounds: visualBounds(outline, run.height),
      visualLayer: 'structure',
      extrusion: extrude(outline, run.height, scene.light),
      source: { of: 'boundary', run, inward },
    });
  }

  for (const level of scene.levels) {
    if (level.rise <= 0) continue;

    /*
     * **A sunken area is raised by nothing, and that is the honest answer rather than an omission.**
     *
     * What would stand up around a sunken terrace is the ground beyond it, and this model has no
     * ground — `levels.ts` refuses to infer one, for the same reason `site.location` is nullable.
     * So it comes through the stack as a zero-height extrusion: no faces, and a top ring that is
     * its own footprint, which draws the identical band the flat view has always drawn. Handled
     * here rather than skipped, so every level is in exactly one place.
     */
    nodes.push({
      kind: 'extrusion',
      id: `${level.hostId}:wall`,
      depth: depthOf(level.outline),
      bounds: visualBounds(level.outline, level.sunken ? 0 : level.rise),
      visualLayer: 'structure',
      extrusion: extrude(level.outline, level.sunken ? 0 : level.rise, scene.light),
      source: { of: 'level', level },
    });
  }

  for (const surface of scene.edging) {
    const height = surface.height ?? edgingHeight(surface.element.material);
    // A flush join stands proud of nothing, so it has no face to lift into the elevated stack.
    if (height <= 0) continue;
    nodes.push({
      kind: 'extrusion',
      id: surface.elementId,
      depth: depthOf(surface.outline),
      bounds: visualBounds(surface.outline, height),
      visualLayer: 'surface',
      extrusion: extrude(surface.outline, height, scene.light),
      source: { of: 'edging', surface, height },
    });
  }

  if (scene.house) {
    /*
     * The *drawn* eaves, which for anything above a storey is less than the real ones — see
     * `MAX_DRAWN_LIFT`. The shadow pass is untouched and still casts from `houseHeight`, because
     * how far a building shades its own garden is a fact about the site rather than a drawing
     * convention.
     */
    const eaves = drawnLift(houseHeight(scene.house.house));
    nodes.push({
      kind: 'house',
      id: 'house',
      depth: depthOf(scene.house.outline),
      /* The house is the one thing whose drawing reaches *outside* its own footprint on the ground
       * as well as above it: `houseGroundShadow` is the footprint translated half a metre. */
      bounds: visualBounds(marginOf(scene.house.outline), eaves),
      visualLayer: 'house',
      house: scene.house,
      walls: extrude(scene.house.outline, eaves, scene.light),
    });
  }

  return nodes.sort(
    (a, b) =>
      sortGroup(a) - sortGroup(b) ||
      a.depth - b.depth ||
      LAYER_ORDER[a.visualLayer] - LAYER_ORDER[b.visualLayer] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Whether this is a thing that is *built* rather than a thing that is *placed*.
 *
 * The single decision that says which of the two drawing models an element gets, and it is worth
 * being precise about the criterion: not "is it big", not "is it a structure", but **is its shape
 * arbitrary**. A shed is whatever rectangle the placer gave it and can be turned to any angle, so
 * no photograph fits it and it is raised from its own outline. A dining set is a dining set: a known
 * object of a known size that a sprite can be fitted inside.
 *
 * `steps` is deliberately included even though it is short: a flight's whole point is the level
 * change it resolves, and its treads are derived from a rise that only the extrusion can show.
 */
function isBuilt(element: DesignElement): boolean {
  return element.category === 'structure';
}

/**
 * How thick a retaining wall is drawn, in metres, for the height it holds back.
 *
 * A proportion rather than a constant, because the two ends of the range are genuinely different
 * structures: a 150 mm step up is held by an edging board, and a metre of ground needs a wall you
 * could sit on. Clamped at both ends so neither becomes silly — below 100 mm it is a line nobody
 * sees, above 300 mm it starts eating the terrace it supports.
 */
function retainingThickness(rise: number): number {
  return Math.max(0.1, Math.min(0.3, rise * 0.4));
}

/** How much darker than its own paving a wall top is drawn, so the change of level reads. */
const RETAINING_SHADE = -0.18;

/**
 * The retaining faces, resolved to bands the composer can fill.
 *
 * Note what is *not* here: a sunken area gets exactly the same band as a raised one. In plan you
 * are looking down at the top of a wall either way, and which side the ground is on is carried by
 * `sunken` for a backend that wants to shade it differently rather than by a different geometry.
 */
function buildLevels(elements: DesignElement[], scene: PlanScene): RenderLevel[] {
  const bands = levelBands(elements, {
    house: scene.house ? housePolygon(scene.house) : undefined,
  });

  const byId = new Map(elements.map((element) => [element.id, element]));

  return bands.flatMap((band): RenderLevel[] => {
    const host = byId.get(band.hostId);
    if (!host) return [];

    const outline = polylineStrip(band.points, retainingThickness(band.rise));
    if (outline.length < 3) return [];

    /*
     * A chosen walling material draws its real top course through the ordinary surface painter; an
     * unchosen one stays the plain darkened upstand. The synthetic element exists for the same
     * reason `buildEdging`'s does and stays here in the same way — nothing reads it back.
     */
    const material = band.walling ? resolvePattern(band.walling) : null;
    const element: DesignElement = {
      id: `${band.hostId}:wall`,
      category: 'paved-area',
      role: 'fill',
      fillKind: 'accent',
      material: band.walling ?? host.material,
      zone: host.zone,
      shape: { kind: 'polyline', points: band.points, width: retainingThickness(band.rise) },
    };

    return [
      {
        hostId: band.hostId,
        outline,
        rise: band.rise,
        sunken: band.sunken,
        surface: band.walling
          ? {
              elementId: element.id,
              element,
              outline,
              centreline: band.points,
              material,
              layers: material ? [{ entry: material }] : [],
              anchor: patternAnchor(element),
              seed: element.id,
              exclusions: null,
              cutEdge: null,
            }
          : null,
        colour: rgbToCss(shiftBrightness(cssToRgb(materialFill(host)), RETAINING_SHADE)),
      },
    ];
  });
}

/**
 * The edging courses, resolved to surfaces the existing painter can draw.
 *
 * The runs themselves come from `plan/edges/resolve.ts`, which is pure geometry and knows nothing
 * about painting; this wraps each one in the smallest `DesignElement` the surface painter needs.
 * That element is **synthetic and stays here** — it is never pushed onto the document, never
 * counted, and `quantities.ts` reaches edging through `resolveEdges` directly rather than through
 * anything on this scene.
 *
 * **Only what resolved is drawn.** A stretch whose treatment is `none` never arrives here, so a
 * surface with nothing to say draws no outline — the default the old whole-outline course could not
 * have. A flush join arrives with no product: it falls through to the painter's flat strip at the
 * width of a joint, with no height, which is what "these meet level" looks like from above.
 *
 * The id is the resolved run's own, which is stable across renders by construction: the host, the
 * side and either the stored run's id or where the automatic stretch starts. A course keeps its
 * raster cache entry and its seeded tones while the bed it follows is merely selected or renamed.
 */
function buildEdging(runs: ResolvedEdgeRun[]): RenderSurface[] {
  return runs.flatMap((run): RenderSurface[] => {
    const element: DesignElement = {
      id: run.id,
      category: 'paved-area',
      role: 'fill',
      fillKind: 'accent',
      ...(run.materialId ? { material: run.materialId } : {}),
      zone: 'back',
      shape: { kind: 'polyline', points: run.points, width: run.widthM },
    };

    const outline = elementOutline(element);
    if (outline.length < 3) return [];

    const material = run.materialId ? resolvePattern(run.materialId) : null;

    return [
      {
        elementId: element.id,
        element,
        outline,
        centreline: run.points,
        material,
        layers: material ? [{ entry: material }] : [],
        /*
         * The plan origin, like every other surface. A course that anchored to its own start would
         * begin a fresh brick at every corner of a bed, where the whole point of one shared origin
         * is that two runs meeting at a corner are one continuous course.
         */
        anchor: patternAnchor(element),
        seed: element.id,
        exclusions: null,
        cutEdge: null,
        // The run's own height, which may override the product's — a flush join has none.
        height: run.heightM,
      },
    ];
  });
}

/**
 * How big a pool each fitting throws, in metres of radius.
 *
 * Product figures rounded to what a plan can show, not physics. A spike light aimed up a tree
 * spills a wide soft pool; a bollard is deliberately tight, because the point of one is to light
 * the path and not the garden; a recessed tread light is tighter still. Beam angles and lumen
 * output are exactly the kind of number this codebase has no business inventing, so these are
 * stated as what they are — a drawing convention, like `CONTACT_SHADOW_SCALE`.
 */
const LIGHT_POOL_RADIUS: Record<string, number> = {
  'light-spike': 1.8,
  'light-bollard': 1.2,
  'light-recessed': 0.7,
  'light-wall': 1.5,
};

/** Relative output, so a tread light does not read as brightly as an uplight. */
const LIGHT_INTENSITY: Record<string, number> = {
  'light-spike': 1,
  'light-bollard': 0.75,
  'light-recessed': 0.5,
  'light-wall': 0.85,
};

const DEFAULT_POOL_RADIUS = 1.2;

/**
 * The pools thrown by every lit fitting.
 *
 * `night === null` returns nothing at all rather than nothing-shaped: a plan that has never said
 * where it is has no hour, so it has no dark, and drawing a lit garden would be inventing the one
 * fact `site.location` is nullable to refuse. `night === 0` is daylight, where the fittings are
 * still on the plan and simply off.
 */
function buildLights(elements: DesignElement[], night: number | null): RenderLight[] {
  if (night === null || night <= 0) return [];

  const lights: RenderLight[] = [];

  for (const element of elements) {
    if (element.category !== 'lighting') continue;

    const symbol = resolveSymbol(element);
    if (symbol && !isLightSymbol(symbol)) continue;

    const key = symbol ?? '';
    lights.push({
      id: element.id,
      at: elementAnchor(element),
      radius: LIGHT_POOL_RADIUS[key] ?? DEFAULT_POOL_RADIUS,
      intensity: (LIGHT_INTENSITY[key] ?? 0.75) * night,
    });
  }

  return lights;
}

/**
 * The painter's arguments for one element, worked out once.
 *
 * `material` is null when the catalogue has a material with no pattern half — steel, teak, the
 * surveyed `existing` — and that is a legitimate answer rather than a gap: the backend fills it
 * flat. `resolvePattern` returns null for a half-finished entry too, which the palette suite
 * fails loudly about in development.
 */
function resolveSurface(
  element: DesignElement,
  exclusions: Point[][] | null,
  instanced: boolean,
  cutEdge: boolean[] | null,
): RenderSurface | null {
  const outline = elementOutline(element);
  if (outline.length < 3) return null;

  const material = resolvePattern(element.material);

  /* A bed's stack is a property of the bed, so the resolver needs the element and not just the
   * material — the same reason `drawSurfacePattern` takes `element` on its pass. */
  const layers = material ? resolveLayers(material, element) : [];

  return {
    elementId: element.id,
    element,
    outline,
    centreline: elementCentreline(element),
    material,
    /*
     * Instanced planting takes the plant layers off the surface entirely: the ground stays, and
     * everything that would have been painted inside `clip(outline)` is emitted as sprites above
     * it instead. Baked keeps the whole stack, which is what the plan has always drawn.
     */
    layers: instanced ? layers.filter((layer) => !layer.planting) : layers,
    anchor: patternAnchor(element),
    seed: element.id,
    exclusions,
    cutEdge,
  };
}

/**
 * The house as a building. The outline is the geometry of record; the wall band is derived here,
 * every build, and `insetPolygon` refuses a footprint too small to hold one rather than guessing.
 */
function resolveHouse(
  house: HouseFootprint | null,
  roofLight: Point | null,
  light: Point,
): RenderHouse | null {
  if (!house) return null;

  const outline = housePolygon(house);
  if (outline.length < 3) return null;

  return {
    outline,
    interior: insetPolygon(outline, WALL_THICKNESS),
    /*
     * **Both views get a roof now, and _this reverses_ "only Visualise gets one".**
     *
     * The old rule protected step 1, where a building the user is *positioning* has to read as the
     * footprint they are positioning — and it still does, because step 1 draws through its own
     * Konva canvas and never touches this function. What it was also doing, unintentionally, was
     * leaving every concept card, every export and every judging sheet with a flat pale rectangle
     * where the house is: the eye parses that as another paved surface, and the drawing loses the
     * one object that gives the garden its scale and its orientation.
     *
     * **Only Visualise gets eaves.** The overhang is what may not appear in the plan, where the
     * roof *is* the house's drawn extent and geometry outside `housePolygon` could make a legal
     * house look illegal. See `EAVES_OVERHANG`. The plan's roof is drawn strictly within the
     * outline the validator measures, so nothing measurable changes.
     */
    roof: roofFor(outline, roofLight ?? light, {
      overhang: roofLight ? EAVES_OVERHANG : 0,
      material: house.roofMaterial,
    }),
    openings: resolveOpenings(house),
    house,
  };
}

/**
 * Every opening that currently resolves, with its span and its outward normal.
 *
 * Resolved here rather than in the painters so both backends draw from one answer, and skipped
 * rather than clamped when it does not resolve — the rule `openings.ts` sets and the canvas
 * already follows. Nothing here measures anything: `openingSegment` and `openingNormal` are the
 * same functions the generator reads, so the picture cannot disagree with the design.
 */
function resolveOpenings(house: HouseFootprint): RenderOpening[] {
  return house.openings.flatMap((opening) => {
    const segment = openingSegment(house, opening);
    const normal = openingNormal(house, opening);

    return segment && normal ? [{ opening, segment, normal }] : [];
  });
}
