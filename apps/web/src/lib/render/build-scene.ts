import {
  boundaryRuns,
  boundingBox,
  edgingRuns,
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
  resolveSymbol,
  shadowCast,
  shadowOccluders,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { resolveLayers } from '../materials/layers';
import { LIGHT_DIRECTION } from '../materials/light';
import { materialFill } from '../material-colours';
import { cssToRgb, rgbToCss, shiftBrightness } from '../materials/light';
import { edgingWidth, resolvePattern } from '../materials/palette';
import { plantingExclusions, scenePasses } from '../materials/scene-passes';
import { WALL_THICKNESS } from '../materials/symbols/property';
import { buildPlants } from './plants';
import { roofFor } from './roof';
import {
  DEFAULT_SCENE_OPTIONS,
  type RenderHouse,
  type RenderItem,
  type RenderLevel,
  type RenderLight,
  type RenderOpening,
  type RenderPlant,
  type RenderScene,
  type RenderSurface,
  type SceneOptions,
} from './scene';
import { layerForElement } from './visual-layer';

/** What is drawn. The same subset of the document every canvas already works from. */
export interface PlanScene {
  boundary: Point[];
  house: HouseFootprint | null;
  elements: DesignElement[];
  /** Read for its sun and its boundary styling. `location: null` means no solar claim is made. */
  site: SiteSection;
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
  const { view, maturity } = { ...DEFAULT_SCENE_OPTIONS, ...options };
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

  const ground = passes.ground.map((element): RenderItem => {
    /*
     * Only ground-pass beds compute exclusions, exactly as `drawPlan` has always done. The object
     * pass leaves the field null, which is not the same as empty: null means "this item does not
     * speak for exclusions", so the pass's own value stands and a caller that set one keeps it.
     */
    const exclusions = plantingExclusions(element, elements);
    const surface = resolveSurface(element, exclusions, instanced);

    /*
     * Instanced mode takes the plant layers off the surface and emits them here instead. The
     * exclusions travel with them: a structure standing in a bed leaves the same gap in the
     * sprites that it left in the texture.
     */
    if (instanced && surface?.material) {
      const stack = resolveLayers(surface.material, element);
      plants.push(...buildPlants(element, stack, surface.outline, exclusions, maturity));
    }

    return { element, part: 'ground', surface, visualLayer: layerForElement(element) };
  });

  const objects = passes.objects.map((element): RenderItem => ({
    element,
    /* A pergola is drawn in both passes: its deck below the shadows, its beams above them. */
    part: element.symbol === 'pergola' ? 'object' : 'all',
    surface: resolveSurface(element, null, instanced),
    visualLayer: layerForElement(element),
  }));

  return {
    boundary: scene.boundary,
    bounds: boundingBox(scene.boundary),
    ground,
    objects,
    plants,
    house: resolveHouse(scene.house, instanced ? light : null),
    shadows: {
      cast: shadowCast(scene.site),
      occluders: shadowOccluders(elements, scene.house, boundaryRuns(scene.site)),
    },
    light,
    night,
    lights: buildLights(elements, night),
    edging: buildEdging(elements, scene),
    levels: buildLevels(elements, scene),
    maturity,
    view,
    boundaryRuns: boundaryRuns(scene.site),
  };
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
 * The runs themselves come from `plan/edging.ts`, which is pure geometry and knows nothing about
 * painting; this wraps each one in the smallest `DesignElement` the surface painter needs. That
 * element is **synthetic and stays here** — it is never pushed onto the document, never counted,
 * and `quantities.ts` reaches edging through `edgingRuns` directly rather than through anything on
 * this scene.
 *
 * The id is `${hostId}:edge:${n}`, which is stable across renders by construction: the runs come
 * out of the host's own outline in a fixed order, so a course keeps its identity — and therefore
 * its raster cache entry and its seeded tones — as long as the bed is not reshaped.
 *
 * The exclusions are passed in full. A run against the fence or against the house is not drawn for
 * the same reason it is not ordered: it is not there.
 */
function buildEdging(elements: DesignElement[], scene: PlanScene): RenderSurface[] {
  const runs = edgingRuns(elements, {
    boundary: scene.boundary,
    house: scene.house ? housePolygon(scene.house) : undefined,
  });

  const perHost = new Map<string, number>();

  return runs.flatMap((run): RenderSurface[] => {
    const index = perHost.get(run.hostId) ?? 0;
    perHost.set(run.hostId, index + 1);

    const element: DesignElement = {
      id: `${run.hostId}:edge:${index}`,
      category: 'paved-area',
      role: 'fill',
      fillKind: 'accent',
      material: run.material,
      zone: 'back',
      shape: { kind: 'polyline', points: run.points, width: edgingWidth(run.material) },
    };

    const outline = elementOutline(element);
    if (outline.length < 3) return [];

    const material = resolvePattern(run.material);

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
  };
}

/**
 * The house as a building. The outline is the geometry of record; the wall band is derived here,
 * every build, and `insetPolygon` refuses a footprint too small to hold one rather than guessing.
 */
function resolveHouse(house: HouseFootprint | null, roofLight: Point | null): RenderHouse | null {
  if (!house) return null;

  const outline = housePolygon(house);
  if (outline.length < 3) return null;

  return {
    outline,
    interior: insetPolygon(outline, WALL_THICKNESS),
    /* Only Visualise gets a roof: step 1 and the editor want the wall-and-floor diagram, where a
     * building the user is positioning has to read as the footprint they are positioning. */
    roof: roofLight ? roofFor(outline, roofLight) : null,
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
