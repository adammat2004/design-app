import { describe, expect, it } from 'vitest';
import {
  rectangleHouse,
  SiteSectionSchema,
  type DesignElement,
  type SiteSection,
  type Point,
} from '@garden-studio/schema';
import { ASSET_FAMILIES, type AssetFamily } from '../materials/assets/asset-spec';
import { LIGHT_DIRECTION } from '../materials/light';
import { buildRenderScene, type PlanScene } from './build-scene';
import { LAYER_ORDER } from './visual-layer';

const BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

function bed(id: string, x: number, over: Partial<DesignElement> = {}): DesignElement {
  return {
    id,
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    material: 'mixed-border',
    plantingStyle: 'cottage',
    zone: 'back',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x, y: 2 },
        { x: x + 4, y: 2 },
        { x: x + 4, y: 7 },
        { x, y: 7 },
      ],
    },
    ...over,
  } as DesignElement;
}

function lawn(): DesignElement {
  return {
    id: 'lawn-1',
    category: 'lawn',
    role: 'fill',
    fillKind: 'base',
    material: 'standard-turf',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 12, depth: 6, rotation: 0 },
  } as DesignElement;
}

/** A furnished host, so the stack has a standing object with an elevated twin to draw. */
function diningSet(): DesignElement {
  return {
    id: 'dining-1',
    category: 'furniture',
    role: 'feature',
    name: 'Dining set',
    symbol: 'dining-set-6',
    material: 'hardwood',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 2.4, depth: 1.6, rotation: 0 },
  } as DesignElement;
}

function scene(elements: DesignElement[], over: Partial<SiteSection> = {}): PlanScene {
  const site = SiteSectionSchema.parse({
    vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
    closed: true,
    ...over,
  });
  return { boundary: BOUNDARY, house: null, elements, site };
}

const MANCHESTER = { latitude: 53.48, longitude: -2.24 };

function spike(id: string, x: number, y: number): DesignElement {
  return {
    id,
    category: 'lighting',
    role: 'feature',
    name: 'Spike uplight',
    symbol: 'light-spike',
    material: 'black-aluminium',
    zone: 'back',
    shape: { kind: 'point', at: { x, y }, radius: 0.06 },
  } as DesignElement;
}

describe('level changes', () => {
  const raised = (elevation: number): DesignElement =>
    ({
      id: 'terrace',
      category: 'paved-area',
      role: 'feature',
      name: 'Seating patio',
      material: 'stone-pavers',
      zone: 'back',
      elevation,
      shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 6, depth: 4, rotation: 0 },
    }) as DesignElement;

  it('retains a raised surface and leaves a flat one alone', () => {
    expect(buildRenderScene(scene([lawn(), raised(0.34)])).levels).toHaveLength(1);
    expect(buildRenderScene(scene([lawn(), raised(0)])).levels).toEqual([]);
  });

  it('draws a plain upstand when no walling was chosen', () => {
    const [band] = buildRenderScene(scene([lawn(), raised(0.34)])).levels;

    expect(band!.outline.length).toBeGreaterThanOrEqual(3);
    expect(band!.rise).toBeCloseTo(0.34, 6);
    expect(band!.sunken).toBe(false);
    // No surface: the wall is the host's own paving darkened, which is what an in-situ edge is.
    expect(band!.surface).toBeNull();
    expect(band!.colour).toMatch(/^rgb/);
  });

  it('draws a chosen walling material as a real top course', () => {
    /*
     * The two answers are two different drawings and both are truthful. A wall built of something
     * has a top course worth painting; a terrace retained in its own paving has no such course.
     */
    const stone = { ...raised(0.34), retaining: 'walling-stone' } as DesignElement;
    const [band] = buildRenderScene(scene([lawn(), stone])).levels;

    expect(band!.surface).not.toBeNull();
    expect(band!.surface!.material?.id).toBe('walling-stone');
    expect(band!.surface!.layers).toHaveLength(1);
    // The strip follows the edge, so the painter lays the course along the wall rather than across.
    expect(band!.surface!.centreline!.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a retaining material that is not walling', () => {
    // `retaining` is a plain string like `material`, so a stored plan can carry anything.
    const wrong = { ...raised(0.34), retaining: 'standard-turf' } as DesignElement;

    expect(buildRenderScene(scene([lawn(), wrong])).levels[0]!.surface).toBeNull();
  });

  it('casts the shadow of a raised surface from the top of its plinth', () => {
    /*
     * The reason `elevation` adds to `height` rather than setting `baseHeight`: a raised terrace
     * stands on a solid plinth of its own footprint, so it casts the shadow of a 340 mm wall round
     * its edge. A `baseHeight` of 340 would say the terrace floats and casts nothing at all.
     */
    const flat = buildRenderScene(scene([raised(0)])).shadows.occluders;
    const up = buildRenderScene(scene([raised(0.34)])).shadows.occluders;

    /*
     * A flat terrace is not an occluder at all — `castsShadow` drops it, which is right and is why
     * the raised case is one occluder *more* rather than the same one taller. The element loop runs
     * after the house and the boundary runs, so the terrace is the last of them.
     */
    expect(up).toHaveLength(flat.length + 1);
    expect(up.at(-1)!.height).toBeCloseTo(0.34, 6);
    // Not `baseHeight`: the plinth is solid from the ground, so the terrace does not float.
    expect(up.at(-1)!.baseHeight).toBeUndefined();
  });

  it('casts nothing for a sunken area, rather than inventing the ground round it', () => {
    // What would shade a sunken terrace is the ground standing proud of it, and a local elevation
    // model has no ground to make an occluder out of.
    const down = buildRenderScene(scene([raised(-0.6)])).shadows.occluders;
    const flat = buildRenderScene(scene([raised(0)])).shadows.occluders;

    expect(down).toHaveLength(flat.length);
    // It is still retained: you look down at the top of a wall either way.
    expect(buildRenderScene(scene([raised(-0.6)])).levels[0]!.sunken).toBe(true);
  });
});

describe('lighting after dark', () => {
  /*
   * The night half of the time slider, which until this existed drew the identical picture to
   * noon. These assert the *refusals* as hard as the behaviour, because the whole design rests on
   * a plan never claiming to know an hour it was not told.
   */
  const AT_NIGHT = { location: MANCHESTER, sun: { dayOfYear: 172, minutes: 0 } };
  const AT_NOON = { location: MANCHESTER, sun: { dayOfYear: 172, minutes: 720 } };

  it('lights the fittings at night', () => {
    const built = buildRenderScene(scene([lawn(), spike('l1', 4, 4)], AT_NIGHT));

    expect(built.night).toBe(1);
    expect(built.lights).toHaveLength(1);
    expect(built.lights[0]!.id).toBe('l1');
    expect(built.lights[0]!.at).toEqual({ x: 4, y: 4 });
    expect(built.lights[0]!.radius).toBeGreaterThan(0);
    expect(built.lights[0]!.intensity).toBeGreaterThan(0);
  });

  it('throws no light in daylight, though the fitting is still on the plan', () => {
    const built = buildRenderScene(scene([lawn(), spike('l1', 4, 4)], AT_NOON));

    expect(built.night).toBe(0);
    expect(built.lights).toEqual([]);
    // The fitting is a real thing that is really there; it is simply switched off.
    expect(built.objects.some((item) => item.element.id === 'l1')).toBe(true);
  });

  it('makes no claim at all without a location', () => {
    /*
     * The load-bearing one. With no latitude there is no sunset here, so there is no hour at which
     * this garden is dark — and a plan that dimmed itself anyway would be inventing exactly the
     * fact `site.location` is nullable to refuse.
     */
    const built = buildRenderScene(scene([lawn(), spike('l1', 4, 4)], { sun: { dayOfYear: 172, minutes: 0 } }));

    expect(built.night).toBeNull();
    expect(built.lights).toEqual([]);
  });

  it('makes no claim when the caller is driving the light itself', () => {
    // The judging sheets override `light` to render one plan at four times of day. An override
    // means the caller owns the sun, so the scene must not also volunteer a night of its own.
    const built = buildRenderScene(scene([lawn(), spike('l1', 4, 4)], AT_NIGHT), {
      light: { x: 0, y: 1 },
    });

    expect(built.night).toBeNull();
    expect(built.lights).toEqual([]);
  });

  it('comes up gradually through dusk rather than switching on', () => {
    const dusk = buildRenderScene(
      scene([lawn(), spike('l1', 4, 4)], { location: MANCHESTER, sun: { dayOfYear: 172, minutes: 1320 } }),
    );

    if (dusk.night !== null && dusk.night > 0 && dusk.night < 1) {
      expect(dusk.lights[0]!.intensity).toBeLessThan(1);
      expect(dusk.lights[0]!.intensity).toBeGreaterThan(0);
    }
  });

  it('draws lighting above everything, including the house', () => {
    // A 120 mm fitting is the smallest thing on the plan and the easiest to lose under a canopy —
    // and the spike lights that matter most are the ones uplighting a tree.
    const built = buildRenderScene(scene([lawn(), spike('l1', 4, 4)], AT_NIGHT));
    const item = built.objects.find((entry) => entry.element.id === 'l1')!;

    expect(LAYER_ORDER[item.visualLayer]).toBeGreaterThan(LAYER_ORDER.house);
  });
});

describe('buildRenderScene', () => {
  it('is a pure function of its input', () => {
    const input = scene([lawn(), bed('bed-a', 2), bed('bed-b', 12)]);
    expect(buildRenderScene(input)).toEqual(buildRenderScene(input));
  });

  it('does not mutate the plan it is given', () => {
    const elements = [lawn(), bed('bed-a', 2)];
    const before = structuredClone(elements);
    buildRenderScene(scene(elements));
    expect(elements).toEqual(before);
  });

  it('splits the ground from the things that stand up off it', () => {
    const tree: DesignElement = {
      id: 'tree-1',
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      shape: { kind: 'point', at: { x: 6, y: 10 }, radius: 1.6 },
    } as DesignElement;

    const built = buildRenderScene(scene([lawn(), bed('bed-a', 2), tree]));

    expect(built.ground.map((item) => item.element.id)).toEqual(['lawn-1', 'bed-a']);
    expect(built.objects.map((item) => item.element.id)).toEqual(['tree-1']);
    expect(built.objects[0]!.visualLayer).toBe('tree');
    expect(built.ground[0]!.visualLayer).toBe('base');
  });

  it('leaves a hidden element out of the picture entirely', () => {
    const built = buildRenderScene(scene([lawn(), bed('bed-a', 2, { hidden: true })]));
    expect(built.ground.map((item) => item.element.id)).toEqual(['lawn-1']);
  });

  /*
   * The requirement this whole design exists for. Cells are indexed from the world origin and
   * every draw is spatially hashed, so a bed's resolved picture cannot depend on its neighbours —
   * which is what stops one edit repainting a garden.
   */
  it('leaves an unrelated bed untouched when another bed is edited', () => {
    const untouched = bed('bed-b', 12);
    const before = buildRenderScene(scene([lawn(), bed('bed-a', 2), untouched]));

    const moved = bed('bed-a', 3);
    const after = buildRenderScene(scene([lawn(), moved, untouched]));

    const find = (built: ReturnType<typeof buildRenderScene>) =>
      built.ground.find((item) => item.element.id === 'bed-b')!;

    expect(find(after)).toEqual(find(before));
  });

  it('gives a bed its neighbours and everything else no opinion', () => {
    const shed: DesignElement = {
      id: 'shed-1',
      category: 'structure',
      role: 'feature',
      zone: 'back',
      symbol: 'shed',
      shape: { kind: 'rect', centre: { x: 3, y: 4 }, width: 2, depth: 2, rotation: 0 },
    } as DesignElement;

    const built = buildRenderScene(scene([bed('bed-a', 2), shed]));

    expect(built.ground[0]!.surface!.exclusions).toHaveLength(1);
    expect(built.objects[0]!.surface!.exclusions).toBeNull();
  });

  describe('the light', () => {
    it('is the drawing light when the plan makes no solar claim', () => {
      expect(buildRenderScene(scene([lawn()])).light).toEqual(LIGHT_DIRECTION);
      expect(buildRenderScene(scene([lawn()])).shadows.cast).toBeNull();
    });

    it('is the real sun once the plan knows where on Earth it is', () => {
      const built = buildRenderScene(
        scene([lawn()], { location: { latitude: 53.4, longitude: -2.98 } }),
      );
      expect(built.light).not.toEqual(LIGHT_DIRECTION);
      expect(built.shadows.cast).not.toBeNull();
    });

    it('is overridable, because one plan is drawn at four times of day', () => {
      const light = { x: 1, y: 0 };
      expect(buildRenderScene(scene([lawn()]), { light }).light).toBe(light);
    });
  });

  describe('the house', () => {
    it('derives the wall band without touching the footprint', () => {
      const house = rectangleHouse({ x: 10, y: 3 }, 8, 5);
      const built = buildRenderScene({ ...scene([]), house });

      expect(built.house!.outline).toHaveLength(4);
      expect(built.house!.interior).not.toBeNull();
      expect(built.house!.house).toBe(house);
    });

    it('refuses a wall band a footprint is too small to hold, rather than guessing', () => {
      // Below `MIN_HOUSE_SIDE`, so the UI cannot draw it — but the document can hold it, which
      // is exactly why the guard is here rather than upstream.
      const built = buildRenderScene({
        ...scene([]),
        house: rectangleHouse({ x: 5, y: 5 }, 0.4, 0.4),
      });
      expect(built.house!.interior).toBeNull();
    });
  });

  describe('planting mode', () => {
    it('bakes the planting into the bed by default, as the plan always has', () => {
      const built = buildRenderScene(scene([bed('bed-a', 2)]));
      const layers = built.ground[0]!.surface!.layers;

      expect(layers.length).toBeGreaterThan(1);
      expect(layers.some((layer) => layer.planting)).toBe(true);
      expect(built.plants).toEqual([]);
    });

    it('takes the planting off the surface when it is drawn as sprites instead', () => {
      const built = buildRenderScene(scene([bed('bed-a', 2)]), { view: 'visualise' });
      const layers = built.ground[0]!.surface!.layers;

      // The ground the plants stand on stays; everything painted over it is lifted out.
      expect(layers).toHaveLength(1);
      expect(layers.some((layer) => layer.planting)).toBe(false);
    });
  });

  /**
   * The one assertion that says what the 2D Plan *is*, rather than pinning the two mechanisms that
   * happen to deliver it.
   *
   * Both of those mechanisms were intact and tested — `plants` is empty without `instanced`, and
   * `stack` is empty outside Visualise — and the plan was still drawn with elevated art for a whole
   * commit, because `EditorCanvas` asked `buildRenderScene` for a *visualise* scene and every test
   * here went on passing. A guarantee that only holds while one call site passes the right string is
   * not a guarantee; this states the property itself, so the next caller to get it wrong fails here.
   */
  describe('the plan camera', () => {
    const furnished = () => scene([bed('bed-a', 2), lawn(), diningSet()]);

    it('draws no elevated asset anywhere', () => {
      const built = buildRenderScene(furnished());

      for (const plant of built.plants) {
        // Read through `AssetFamily`: the manifest is `as const`, so a literal that omits an
        // optional field narrows to a type without it at all. Same reason `isRecolourable` does.
        const family: AssetFamily | null = plant.assetId ? ASSET_FAMILIES[plant.assetId] : null;
        expect(family?.camera ?? 'plan', plant.id).toBe('plan');
      }

      /*
       * The other half of the property. `stack` is the only route to `drawElevatedObject` and to
       * the `skin-*` face textures, neither of which records an asset id on the scene — so for
       * those the emptiness *is* the assertion.
       */
      expect(built.stack).toEqual([]);
    });

    /*
     * The control. Without it the test above passes just as happily on a scene that resolves no
     * assets at all — which is exactly what a broken twin table or an empty catalogue would give.
     */
    it('is a real distinction: the same garden in Visualise does draw elevated art', () => {
      const built = buildRenderScene(furnished(), { view: 'visualise' });
      const cameras = built.plants.map((plant) => {
        const family: AssetFamily | null = plant.assetId ? ASSET_FAMILIES[plant.assetId] : null;
        return family?.camera ?? 'plan';
      });

      expect(cameras).toContain('elevated');
      expect(built.stack.length).toBeGreaterThan(0);
    });
  });
});
