import { describe, expect, it } from 'vitest';
import {
  rectangleHouse,
  SiteSectionSchema,
  type DesignElement,
  type SiteSection,
  type Point,
} from '@garden-studio/schema';
import { LIGHT_DIRECTION } from '../materials/light';
import { buildRenderScene, type PlanScene } from './build-scene';

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

function scene(elements: DesignElement[], over: Partial<SiteSection> = {}): PlanScene {
  const site = SiteSectionSchema.parse({
    vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
    closed: true,
    ...over,
  });
  return { boundary: BOUNDARY, house: null, elements, site };
}

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
});
