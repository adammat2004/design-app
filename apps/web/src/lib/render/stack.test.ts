import { describe, expect, it } from 'vitest';
import {
  houseHeight,
  rectangleHouse,
  SiteSectionSchema,
  type DesignElement,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { buildRenderScene, type PlanScene } from './build-scene';

const BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

function scene(elements: DesignElement[], over: Partial<SiteSection> = {}): PlanScene {
  const site = SiteSectionSchema.parse({
    vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
    closed: true,
    ...over,
  });
  return { boundary: BOUNDARY, house: null, elements, site };
}

const shed: DesignElement = {
  id: 'shed-1',
  category: 'structure',
  role: 'feature',
  name: 'Garden store',
  symbol: 'shed',
  material: 'softwood',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 5, y: 4 }, width: 2.5, depth: 2, rotation: 0 },
};

const bed = (edging?: string): DesignElement => ({
  id: 'bed-1',
  category: 'planting-bed',
  role: 'feature',
  name: 'Border',
  material: 'mixed-border',
  ...(edging ? { edging } : {}),
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 8 }, width: 4, depth: 2, rotation: 0 },
});

describe('the stack', () => {
  /**
   * The plan's stack is its planting and nothing else. It held a whole elevated drawing — extruded
   * sheds, a lifted house, fences with faces — while the Visualise view existed; none of that may
   * come back into the plan by a later edit.
   */
  it('holds the plants and nothing that is built', () => {
    const built = buildRenderScene(scene([shed, bed()]));

    expect(built.stack.length).toBeGreaterThan(0);
    expect(built.stack).toHaveLength(built.plants.length);
    expect(built.stack.every((node) => node.kind === 'plant')).toBe(true);
    expect(built.stack.some((node) => node.id === 'shed-1')).toBe(false);
  });

  it('is the same list twice for the same plan', () => {
    const a = buildRenderScene(scene([shed, bed()])).stack.map((node) => node.id);
    const b = buildRenderScene(scene([shed, bed()])).stack.map((node) => node.id);

    expect(a).toEqual(b);
  });

  it('leaves edging courses flat on the ground', () => {
    const built = buildRenderScene(scene([bed('concrete-kerb')]));

    expect(built.stack.every((node) => node.kind === 'plant')).toBe(true);
    expect(built.edging.length).toBeGreaterThan(0);
  });
});

describe('the house', () => {
  /** How far a building shades its own garden is a fact about the site, not a drawing convention. */
  it('casts its shadow from the real eaves', () => {
    const house = rectangleHouse({ x: 10, y: 3 }, 8, 5);
    const built = buildRenderScene(
      { ...scene([]), house },
      { light: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
    );

    const tallest = Math.max(...built.shadows.occluders.map((occluder) => occluder.height));
    expect(tallest).toBeCloseTo(houseHeight(house), 6);
  });

  /**
   * The rule the whole render directory rests on: the roof is derived from the footprint and the
   * footprint is handed back untouched. A house that fits must never be refused because of
   * something the renderer drew on it.
   */
  it('leaves the footprint exactly as the document has it, with the roof inside it', () => {
    const house = rectangleHouse({ x: 10, y: 3 }, 8, 5);
    const built = buildRenderScene({ ...scene([]), house });

    expect(built.house!.house).toBe(house);
    expect(built.house!.roof!.eaves).toEqual(built.house!.outline);
  });
});
