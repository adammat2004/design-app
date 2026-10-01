import {
  effectiveBoundaryRuns,
  kerbLines,
  boundingBox,
  cutEdgeMasksFor,
  resolveEdges,
  type EdgeRuleContext,
  type ResolvedEdgeRun,
  elementAnchor,
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
  retainingThickness,
  resolveSymbol,
  shadowOccluders,
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
import { WALL_THICKNESS } from '../materials/symbols/property';
import { buildPlants } from './plants';
import { roofFor } from './roof';
import { visualBounds } from './projection';
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
import { layerForElement } from './visual-layer';
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
  const { rendererVersion, shadows } = { ...DEFAULT_SCENE_OPTIONS, ...options };

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
     * Planting is instanced: lifted out of the bed's raster and drawn as sprites above it. A bed
     * painted inside `clip(outline)` is a cut-out by construction — no plant can cross its own
     * edge, nothing spills onto the lawn beside it — and that clip was the largest single reason
     * the plan read as a diagram. It was never what made the plan *measurable*: the outline is
     * still the geometry of record, still what selection, handles, dimensions and the schedule
     * use. Only the picture overhangs, exactly as a tree canopy has always been allowed to.
     *
     * The exclusions travel with them: a structure standing in a bed leaves the same gap in the
     * sprites that it left in the texture.
     */
    if (surface?.material) {
      const stack = resolveLayers(surface.material, element);
      plants.push(
        ...buildPlants(element, stack, surface.outline, exclusions),
      );
    }

    return { element, part: 'ground', surface, visualLayer: layerForElement(element) };
  });

  const objects = passes.objects.map((element): RenderItem => ({
    element,
    /* A pergola is drawn in both passes: its deck below the shadows, its beams above them. */
    part: element.symbol === 'pergola' ? 'object' : 'all',
    surface: resolveSurface(element, null, false, cutEdges.get(element.id) ?? null),
    visualLayer: layerForElement(element),
  }));

  const house = resolveHouse(scene.house, light);
  /*
   * The property's sides as the design leaves them: the survey less what a proposed fence or wall
   * replaces, and the proposals themselves. Only the survey's runs cast here — a proposal is an
   * element, and every element already casts below, so adding its run would shade it twice.
   */
  const boundary = effectiveBoundaryRuns(scene.site, elements);
  const runs = boundary.survey;
  const levels = buildLevels(elements, scene);
  /* A kerb is a course on the ground: laid by the edging painter, in the concrete kerb's pattern. */
  const kerbs = kerbLines(elements).map((kerb) => ({
    id: `kerb:${kerb.id}`,
    materialId: 'concrete-kerb',
    points: kerb.points,
    widthM: kerb.width,
    heightM: 0.1,
  }));
  const edging = buildEdging([...edgeResolution.runs, ...kerbs]);
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
    boundaryRuns: [...runs, ...boundary.proposed],
    replacedRuns: boundary.replaced,
    /*
     * The stack holds the plants and nothing else. The v2 renderer draws standing things from it
     * rather than from `plants`, so Pixi and the composer draw the planting from one list.
     */
    stack: plantNodes(plants),
  };
  const rendered: RenderScene = { ...content, ...compilePrimitives(content, scene.site) };
  recordCompilation(rendered, clockNow() - started);
  return rendered;
}

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

/**
 * One node per plant.
 *
 * `visualBounds` lifts the box by half the plant's height because that is what the *drawing* does
 * — the sprite is drawn a little up the screen so a tall thing reads as standing — and the bounds
 * have to cover what is painted or the raster clips it.
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
function buildEdging(runs: Pick<ResolvedEdgeRun, 'id' | 'materialId' | 'points' | 'widthM' | 'heightM'>[]): RenderSurface[] {
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
  plantingLifted: boolean,
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
     * A ground bed's planting is lifted off the surface entirely: the ground stays, and everything
     * that would have been painted inside `clip(outline)` is emitted as sprites above it instead.
     * An object pass keeps the whole stack baked, which is what it has always drawn.
     */
    layers: plantingLifted ? layers.filter((layer) => !layer.planting) : layers,
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
function resolveHouse(house: HouseFootprint | null, light: Point): RenderHouse | null {
  if (!house) return null;

  const outline = housePolygon(house);
  if (outline.length < 3) return null;

  return {
    outline,
    interior: insetPolygon(outline, WALL_THICKNESS),
    /*
     * A roof, drawn strictly within the outline the validator measures: no eaves overhang, because
     * geometry outside `housePolygon` could make a legal house look illegal. Without it every
     * concept card, export and sheet had a flat pale rectangle where the house is, which the eye
     * parses as another paved surface. Step 1 draws its own Konva canvas and never reaches this.
     */
    roof: roofFor(outline, light, { material: house.roofMaterial }),
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
