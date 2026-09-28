import { describe, expect, it } from 'vitest';
import {
  pointInPolygon,
  SiteSectionSchema,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { buildRenderScene, type PlanScene } from './build-scene';
import type { RenderPlant } from './scene';

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

function plantsOf(elements: DesignElement[]): RenderPlant[] {
  return buildRenderScene(scene(elements)).plants;
}

describe('render-only planting', () => {
  it('fills a bed with plants once they are lifted out of its raster', () => {
    const plants = plantsOf([bed('bed-a', 2)]);
    expect(plants.length).toBeGreaterThan(20);
  });

  it('is byte-for-byte the same garden twice', () => {
    expect(plantsOf([bed('bed-a', 2)])).toEqual(plantsOf([bed('bed-a', 2)]));
  });

  it('has a middle storey in deep beds, without changing the document or crowding narrow transitions', () => {
    const deep = bed('deep', 2);
    const before = JSON.stringify(deep);
    const shrubs = plantsOf([deep]).filter((p) => p.visualLayer === 'shrub');
    expect(shrubs.length).toBeGreaterThan(3);
    expect(shrubs.every((p) => p.spread >= 0.8 && p.height >= 0.7)).toBe(true);
    expect(JSON.stringify(deep)).toBe(before);
    const narrow = bed('narrow', 2, { shape: { kind: 'rect', centre: { x: 3, y: 5 }, width: 0.6, depth: 6, rotation: 0 } });
    expect(plantsOf([narrow]).filter((p) => p.visualLayer === 'shrub')).toHaveLength(0);
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

  /*
   * Coverage, measured rather than inferred. Summing crown areas double-counts every overlap, so
   * it says nothing about how much ground is actually hidden; sampling the bed on a lattice and
   * asking whether any crown reaches each point is the real quantity, and it is the one the
   * requirement is written in.
   */
  describe('coverage', () => {
    const AREA = { x: 2, y: 2, width: 6, length: 7 };

    function covered(): number {
      const plants = plantsOf([bed('bed-a', 2)]);
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
     * A deep mature border closes, and the band now says so. _This reverses_ the old 70-95%, which
     * was calibrated when the drawn plants were 0.45 m across: reaching 95% then would have taken
     * fifteen plants per square metre, so the ceiling was really a cap on density and the floor was
     * the honest number. With plants drawn at their mature spread the same bed closes to ~99%, and
     * that is what a six-by-seven-metre mixed border in its third year *is*.
     *
     * The old ceiling's argument — that without gaps the planting reads as a flat mat — was right
     * about the risk and wrong about the remedy. What makes individual plants legible is that they
     * differ in size, and `measure:render` reports that directly: the share of plants under half a
     * metre fell from about 80% to about 20% in the same change that closed the bed. Bare soil
     * between crowns is not the thing doing that work.
     *
     * `PLANTING_REPORT=1 pnpm test` prints where inside the band we actually sit instead of only
     * asserting that we are somewhere in it — the same escape hatch `COMPOSITION_REPORT=1` gives
     * over the generator. It exists because the band was once argued to be "too low" while nobody
     * had measured which end of it we were at, and a range that wide can hide a real change at
     * either edge.
     */
    it('closes a mature bed almost completely, without quite tiling it', () => {
      const fraction = covered();

      if (process.env.PLANTING_REPORT === '1') {
        console.log(`\n  PLANTING COVERAGE   ${(fraction * 100).toFixed(1)}%\n`);
      }

      expect(fraction).toBeGreaterThan(0.9);
      expect(fraction).toBeLessThan(0.999);
    });
  });
});
