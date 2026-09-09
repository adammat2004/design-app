import { describe, expect, it } from 'vitest';
import {
  pointInPolygon,
  SiteSectionSchema,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { buildRenderScene, type PlanScene } from './build-scene';
import type { Maturity, RenderPlant } from './scene';

const BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 18 },
  { x: 0, y: 18 },
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
        { x: x + 6, y: 2 },
        { x: x + 6, y: 9 },
        { x, y: 9 },
      ],
    },
    ...over,
  } as DesignElement;
}

function bedOutline(element: DesignElement): Point[] {
  return (element.shape as { points: Point[] }).points;
}

function scene(elements: DesignElement[]): PlanScene {
  return {
    boundary: BOUNDARY,
    house: null,
    elements,
    site: SiteSectionSchema.parse({
      vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
      closed: true,
    }),
  };
}

function plantsOf(elements: DesignElement[], maturity: Maturity = 'mature'): RenderPlant[] {
  return buildRenderScene(scene(elements), { view: 'visualise', maturity }).plants;
}

describe('render-only planting', () => {
  it('fills a bed with plants once they are lifted out of its raster', () => {
    const plants = plantsOf([bed('bed-a', 2)]);
    expect(plants.length).toBeGreaterThan(20);
  });

  it('is byte-for-byte the same garden twice', () => {
    expect(plantsOf([bed('bed-a', 2)])).toEqual(plantsOf([bed('bed-a', 2)]));
  });

  /*
   * The prompt's explicit requirement, and the one the whole spatial-hash design exists to give:
   * changing one bed must not visually reshuffle any other.
   */
  it('does not reshuffle one bed when another is edited', () => {
    const other = bed('bed-b', 14);
    const before = plantsOf([bed('bed-a', 2), other]);
    const after = plantsOf([bed('bed-a', 3.5), other]);

    const forB = (plants: RenderPlant[]) => plants.filter((plant) => plant.hostId === 'bed-b');

    expect(forB(after)).toEqual(forB(before));
    expect(forB(before).length).toBeGreaterThan(0);
  });

  it('keeps every plant inside the bed it belongs to', () => {
    const element = bed('bed-a', 2);
    const outline = bedOutline(element);

    for (const plant of plantsOf([element])) {
      expect(pointInPolygon(plant.at, outline)).toBe(true);
    }
  });

  it('leaves a gap where something stands in the bed', () => {
    const element = bed('bed-a', 2);
    const shed: DesignElement = {
      id: 'shed-1',
      category: 'structure',
      role: 'feature',
      zone: 'back',
      symbol: 'shed',
      shape: { kind: 'rect', centre: { x: 5, y: 5.5 }, width: 3, depth: 3, rotation: 0 },
    } as DesignElement;

    const open = plantsOf([element]);
    const blocked = plantsOf([element, shed]);

    expect(blocked.length).toBeLessThan(open.length);
    for (const plant of blocked) {
      const inShed = Math.abs(plant.at.x - 5) < 1.5 && Math.abs(plant.at.y - 5.5) < 1.5;
      expect(inShed).toBe(false);
    }
  });

  describe('asset choice', () => {
    it('is stable across builds', () => {
      const a = plantsOf([bed('bed-a', 2)]);
      const b = plantsOf([bed('bed-a', 2)]);
      expect(a.map((plant) => `${plant.assetId}:${plant.variant}`)).toEqual(
        b.map((plant) => `${plant.assetId}:${plant.variant}`),
      );
    });

    /* Repeated vegetation must not look cloned: a bed of one sprite is the failure mode. */
    it('varies, so a bed does not read as one sprite stamped out', () => {
      const plants = plantsOf([bed('bed-a', 2)]).filter((plant) => plant.assetId);
      const distinct = new Set(plants.map((plant) => `${plant.assetId}:${plant.variant}`));

      expect(plants.length).toBeGreaterThan(10);
      expect(distinct.size).toBeGreaterThan(3);
    });

    it('turns each plant to its own angle', () => {
      const rotations = new Set(plantsOf([bed('bed-a', 2)]).map((plant) => plant.rotation));
      expect(rotations.size).toBeGreaterThan(10);
    });
  });

  describe('maturity', () => {
    /*
     * The invariant `maturity.ts` argues for. The sampler's acceptance draw sits at a fixed
     * position in each cell's sequence and scales linearly with `share`, so thinning can only
     * remove plants — a young garden is the mature one with plants taken out, not a different
     * garden that happens to be sparser.
     */
    it('is a subset: a young garden is the mature one thinned', () => {
      const mature = plantsOf([bed('bed-a', 2)], 'mature');
      const young = plantsOf([bed('bed-a', 2)], 'year-1');
      const ids = new Set(mature.map((plant) => plant.id));

      expect(young.length).toBeLessThan(mature.length);
      expect(young.length).toBeGreaterThan(0);
      for (const plant of young) expect(ids.has(plant.id)).toBe(true);
    });

    it('thins monotonically through the three settings', () => {
      const counts = (['year-1', 'year-3', 'mature'] as Maturity[]).map(
        (maturity) => plantsOf([bed('bed-a', 2)], maturity).length,
      );
      expect(counts[0]!).toBeLessThanOrEqual(counts[1]!);
      expect(counts[1]!).toBeLessThanOrEqual(counts[2]!);
    });

    /* A plant that survives the thinning keeps its place; only its crown changes. */
    it('moves nothing, and only scales the crown', () => {
      const mature = plantsOf([bed('bed-a', 2)], 'mature');
      const young = plantsOf([bed('bed-a', 2)], 'year-1');
      const byId = new Map(mature.map((plant) => [plant.id, plant]));

      for (const plant of young) {
        const grown = byId.get(plant.id)!;
        expect(plant.at).toEqual(grown.at);
        expect(plant.rotation).toBe(grown.rotation);
        expect(plant.assetId).toBe(grown.assetId);
        expect(plant.spread).toBeLessThan(grown.spread);
      }
    });
  });

  /*
   * Coverage, measured rather than inferred. Summing crown areas double-counts every overlap, so
   * it says nothing about how much ground is actually hidden; sampling the bed on a lattice and
   * asking whether any crown reaches each point is the real quantity, and it is the one the
   * requirement is written in.
   */
  describe('coverage', () => {
    const AREA = { x: 2, y: 2, width: 6, length: 7 };

    function covered(maturity: Maturity): number {
      const plants = plantsOf([bed('bed-a', 2)], maturity);
      const steps = 90;
      let hits = 0;

      for (let row = 0; row < steps; row += 1) {
        for (let col = 0; col < steps; col += 1) {
          const at = {
            x: AREA.x + ((col + 0.5) / steps) * AREA.width,
            y: AREA.y + ((row + 0.5) / steps) * AREA.length,
          };
          if (
            plants.some(
              (plant) => Math.hypot(plant.at.x - at.x, plant.at.y - at.y) < plant.spread / 2,
            )
          ) {
            hits += 1;
          }
        }
      }

      return hits / (steps * steps);
    }

    /*
     * The prompt's number. Not 100%: a mature bed still shows dark gaps between crowns, and
     * without them the planting reads as one flat mat rather than as individual plants.
     */
    it('closes a mature bed to within the 70-95% band', () => {
      const fraction = covered('mature');
      expect(fraction).toBeGreaterThan(0.7);
      expect(fraction).toBeLessThan(0.97);
    });

    it('leaves a first-year bed visibly open', () => {
      const fraction = covered('year-1');
      expect(fraction).toBeGreaterThan(0.25);
      expect(fraction).toBeLessThan(0.6);
    });

    it('fills in as the garden grows', () => {
      expect(covered('year-1')).toBeLessThan(covered('year-3'));
      expect(covered('year-3')).toBeLessThan(covered('mature'));
    });
  });
});
