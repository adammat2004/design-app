import {
  boundaryRuns,
  boundingBox,
  elementCentreline,
  elementOutline,
  housePolygon,
  insetPolygon,
  lightDirection,
  patternAnchor,
  shadowCast,
  shadowOccluders,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { resolveLayers } from '../materials/layers';
import { LIGHT_DIRECTION } from '../materials/light';
import { resolvePattern } from '../materials/palette';
import { plantingExclusions, scenePasses } from '../materials/scene-passes';
import { WALL_THICKNESS } from '../materials/symbols/property';
import { buildPlants } from './plants';
import { roofFor } from './roof';
import {
  DEFAULT_SCENE_OPTIONS,
  type RenderHouse,
  type RenderItem,
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
    maturity,
    view,
    boundaryRuns: boundaryRuns(scene.site),
  };
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
    house,
  };
}
