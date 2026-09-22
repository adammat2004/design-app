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
import { MAX_DRAWN_LIFT } from '../materials/symbols/elevated';
import { RISE } from './projection';
import type { RenderNode } from './scene';

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

function shed(id: string, y: number, rotation = 0): DesignElement {
  return {
    id,
    category: 'structure',
    role: 'feature',
    name: 'Garden store',
    symbol: 'shed',
    material: 'softwood',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 5, y }, width: 2.5, depth: 2, rotation },
  } as DesignElement;
}

function sofa(id: string, y: number): DesignElement {
  return {
    id,
    category: 'furniture',
    role: 'feature',
    name: 'Lounge set',
    symbol: 'sofa-set',
    material: 'rattan-furniture',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 12, y }, width: 3, depth: 2.4, rotation: 0 },
  } as DesignElement;
}

function tree(id: string, y: number): DesignElement {
  return {
    id,
    category: 'planting-bed',
    role: 'feature',
    name: 'Tree',
    symbol: 'tree-deciduous',
    material: 'mixed-border',
    zone: 'back',
    shape: { kind: 'point', at: { x: 8, y }, radius: 1.6 },
  } as DesignElement;
}

function spike(id: string, y: number): DesignElement {
  return {
    id,
    category: 'lighting',
    role: 'feature',
    name: 'Spike uplight',
    symbol: 'light-spike',
    material: 'black-aluminium',
    zone: 'back',
    shape: { kind: 'point', at: { x: 8, y }, radius: 0.06 },
  } as DesignElement;
}

const visualise = (elements: DesignElement[], over: Partial<PlanScene> = {}) =>
  buildRenderScene({ ...scene(elements), ...over }, { view: 'visualise' });

const find = (stack: RenderNode[], id: string) => stack.find((node) => node.id === id);
const indexOf = (stack: RenderNode[], id: string) => stack.findIndex((node) => node.id === id);

describe('the stack', () => {
  /**
   * The gate for the whole phase: 2D Plan must not change by a pixel, and the cheapest way to be
   * sure of that is for the plan view to emit nothing new at all.
   */
  it('is empty in the plan view', () => {
    const built = buildRenderScene(scene([shed('shed-1', 4), sofa('sofa-1', 10), tree('t1', 6)]));

    expect(built.stack).toEqual([]);
  });

  it('carries everything that stands up, and nothing that lies flat', () => {
    const lawn: DesignElement = {
      id: 'lawn-1',
      category: 'lawn',
      role: 'fill',
      fillKind: 'base',
      material: 'standard-turf',
      zone: 'back',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 12, depth: 6, rotation: 0 },
    } as DesignElement;

    const built = visualise([lawn, shed('shed-1', 4), sofa('sofa-1', 10)]);
    const ids = built.stack.map((node) => node.id);

    expect(ids).toContain('shed-1');
    expect(ids).toContain('sofa-1');
    expect(ids).not.toContain('lawn-1');
  });

  /**
   * The sort that makes the view possible. A shrub at the front of a border drawn *behind* a tree
   * at the back of it is what a layer-first order produces, and it reads as a collage.
   */
  it('draws what is further away first', () => {
    const built = visualise([sofa('near', 13), sofa('far', 4)]);

    expect(indexOf(built.stack, 'far')).toBeLessThan(indexOf(built.stack, 'near'));
  });

  it('measures depth from where a thing stands, not from how tall it is', () => {
    // The tree is far taller than the sofa but stands further away, so it is drawn first.
    const built = visualise([tree('tall-far', 4), sofa('short-near', 12)]);

    expect(indexOf(built.stack, 'tall-far')).toBeLessThan(indexOf(built.stack, 'short-near'));
    expect(find(built.stack, 'tall-far')!.depth).toBeLessThan(
      find(built.stack, 'short-near')!.depth,
    );
  });

  /** Layer is the tiebreak, and a generated plan aligns things constantly, so it is used. */
  it('stacks short under tall when two things stand on the same line', () => {
    const built = visualise([tree('t', 8), sofa('s', 8 - 1.2 + 1.6)]);

    const treeNode = find(built.stack, 't')!;
    const sofaNode = find(built.stack, 's')!;
    expect(treeNode.depth).toBeCloseTo(sofaNode.depth, 6);
    expect(indexOf(built.stack, 's')).toBeLessThan(indexOf(built.stack, 't'));
  });

  it('is total, so the same plan draws the same way twice', () => {
    const elements = [shed('shed-1', 4), shed('shed-2', 4), sofa('sofa-1', 4)];

    expect(visualise(elements).stack.map((node) => node.id)).toEqual(
      visualise(elements).stack.map((node) => node.id),
    );
  });

  /**
   * The one thing that is not depth-sorted, and the reason is written into `LAYER_ORDER`: a spike
   * light is 120 mm, and the ones that matter most are uplighting a tree. Honest depth-sorting
   * would bury every one of them under the thing it lights.
   */
  it('keeps light fittings on top of everything', () => {
    const built = visualise([spike('light', 2), tree('t', 14), sofa('s', 15)]);

    expect(indexOf(built.stack, 'light')).toBe(built.stack.length - 1);
  });
});

describe('what is built and what is placed', () => {
  it('raises a structure from its own outline', () => {
    const node = find(visualise([shed('shed-1', 6)]).stack, 'shed-1')!;

    expect(node.kind).toBe('extrusion');
    if (node.kind !== 'extrusion') throw new Error('not an extrusion');
    expect(node.extrusion.height).toBeCloseTo(2.3, 6);
    expect(node.extrusion.faces.length).toBeGreaterThan(0);
    expect(node.source.of).toBe('element');
  });

  /**
   * The rotation answer, asserted where it is decided rather than where it is drawn: a shed at any
   * angle shows the wall that faces the viewer, because the faces are recomputed from the outline
   * every build. A raster would have that face baked in.
   */
  it('shows a wall whichever way a structure is turned', () => {
    for (const rotation of [0, 37, 90, 180, 313]) {
      const node = find(visualise([shed('shed-1', 6, rotation)]).stack, 'shed-1')!;
      if (node.kind !== 'extrusion') throw new Error('not an extrusion');

      expect(node.extrusion.faces.length, `${rotation}°`).toBeGreaterThan(0);
      for (const face of node.extrusion.faces) {
        expect(face.normal.y, `${rotation}°`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves furniture and plants to their sprites', () => {
    const built = visualise([sofa('sofa-1', 10), tree('t', 6)]);

    expect(find(built.stack, 'sofa-1')!.kind).toBe('object');
    expect(find(built.stack, 't')!.kind).toBe('object');
  });

  it('gives a sprite the height it casts its shadow from', () => {
    const node = find(visualise([sofa('sofa-1', 10)]).stack, 'sofa-1')!;
    if (node.kind !== 'object') throw new Error('not an object');

    // `SYMBOLS['sofa-set'].height`, so the drawing and the shadow cannot disagree.
    expect(node.height).toBeCloseTo(0.8, 6);
  });

  it('counts a raised element from the top of its plinth', () => {
    const raised = {
      ...shed('shed-1', 6),
      elevation: 0.34,
    } as DesignElement;

    const node = find(visualise([raised]).stack, 'shed-1')!;
    if (node.kind !== 'extrusion') throw new Error('not an extrusion');
    expect(node.extrusion.height).toBeCloseTo(2.3 + 0.34, 6);
  });
});

describe('the boundary', () => {
  const styled = (kind: string) =>
    visualise([], {
      site: SiteSectionSchema.parse({
        vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
        closed: true,
        boundaryStyles: BOUNDARY.map((_, index) => ({ edgeVertexId: `v${index}`, kind })),
      }),
    });

  it('raises every run to its own height', () => {
    const built = styled('fence');
    const runs = built.stack.filter((node) => node.id.startsWith('boundary:'));

    expect(runs).toHaveLength(4);
    for (const node of runs) {
      if (node.kind !== 'extrusion') throw new Error('not an extrusion');
      expect(node.extrusion.height).toBeCloseTo(1.8, 6);
    }
  });

  /**
   * The honest consequence of a vertical lift, asserted so that it is a decision rather than a
   * surprise later.
   *
   * A wall running up and down the screen is seen **exactly edge-on**: its two long faces point
   * along ±x, and a lift straight up the screen shows neither. What it does show is the end cap it
   * is a hundred millimetres thick — geometrically correct and, at any zoom, a sliver.
   *
   * This is not a bug to fix but the price of the projection, and the price is worth it: the
   * alternative is leaning the lift diagonally, which shows every wall at the cost of the property
   * the whole application rests on — that a footprint on screen is the footprint the validator
   * measured. A side fence reads as having height through its posts, its shade band and, most of
   * all, the shadow it casts, all of which already exist.
   */
  it('shows a full face only on the runs the camera can actually see one on', () => {
    const built = styled('fence');
    const widest = new Map<string, number>();

    for (const node of built.stack) {
      if (node.kind !== 'extrusion' || !node.id.startsWith('boundary:')) continue;
      widest.set(node.id, Math.max(0, ...node.extrusion.faces.map((face) => face.length)));
    }

    const lengths = [...widest.values()].sort((a, b) => a - b);
    expect(lengths).toHaveLength(4);
    // Two end-cap slivers, one per side return, each the run's own thickness.
    expect(lengths[0]).toBeCloseTo(0.1, 6);
    expect(lengths[1]).toBeCloseTo(0.1, 6);
    // And two real faces, the full length of the near and far boundaries.
    expect(lengths[2]).toBeGreaterThan(15);
    expect(lengths[3]).toBeGreaterThan(15);
  });

  it('says nothing about an open boundary', () => {
    const built = styled('open');

    expect(built.stack.filter((node) => node.id.startsWith('boundary:'))).toEqual([]);
  });
});

describe('edging', () => {
  const bed = (edging: string): DesignElement =>
    ({
      id: 'bed-1',
      category: 'planting-bed',
      role: 'feature',
      name: 'Border',
      material: 'mixed-border',
      edging,
      zone: 'back',
      shape: { kind: 'rect', centre: { x: 10, y: 8 }, width: 4, depth: 2, rotation: 0 },
    }) as DesignElement;

  /**
   * A kerb with no side is a painted stripe, and standing slightly proud of what it edges is the
   * one thing a kerb is for. Small — 50 mm of steel, 200 mm of sleeper — and worth drawing.
   */
  it('raises a course by how far its product stands proud', () => {
    /* By source, not by id: an infill plant whose scheme role is `edge` is also `bed-1:edge:…`. */
    const runs = visualise([bed('timber-sleeper')]).stack.filter(
      (node) => node.kind === 'extrusion' && node.source.of === 'edging',
    );

    expect(runs.length).toBeGreaterThan(0);
    for (const node of runs) {
      if (node.kind !== 'extrusion') throw new Error('not an extrusion');
      expect(node.extrusion.height).toBeCloseTo(0.2, 6);
    }
  });

  it('raises a steel blade by less than a sleeper', () => {
    const course = (material: string) =>
      visualise([bed(material)]).stack.find(
        (node) => node.kind === 'extrusion' && node.source.of === 'edging',
      );
    const steel = course('steel-edging');
    const sleeper = course('timber-sleeper');

    if (steel?.kind !== 'extrusion' || sleeper?.kind !== 'extrusion') {
      throw new Error('both should be extrusions');
    }
    expect(steel.extrusion.height).toBeLessThan(sleeper.extrusion.height);
  });

  it('leaves the plan view drawing its courses flat', () => {
    const built = buildRenderScene(scene([bed('concrete-kerb')]));

    // The plan's stack carries its planting and nothing that stands up, so a kerb there is still
    // the flat band `edging` describes rather than an extrusion with a lit face.
    expect(built.stack.every((node) => node.kind === 'plant')).toBe(true);
    expect(built.edging.length).toBeGreaterThan(0);
  });
});

describe('the house', () => {
  /**
   * Raised to the *drawn* eaves, which above a storey is less than the real ones.
   *
   * The cap is not a rounding: a two-storey house lifts its roof 1.27 m up the screen and every
   * square metre of garden in that strip disappears under it — on the reference fixture, the near
   * half of a dining set. See `MAX_DRAWN_LIFT` for why three metres, and note the thing it must not
   * touch: the shadow still comes off the real eaves.
   */
  it('raises its walls to the drawn eaves, not the real ones', () => {
    const built = visualise([], { house: rectangleHouse({ x: 10, y: 3 }, 8, 5) });
    const node = find(built.stack, 'house')!;

    expect(node.kind).toBe('house');
    if (node.kind !== 'house') throw new Error('not a house');
    // Two storeys by default is 6 m to the eaves; the drawing lifts by a storey.
    expect(node.walls.height).toBeCloseTo(MAX_DRAWN_LIFT, 6);
    expect(node.walls.top[0]!.y).toBeCloseTo(
      node.walls.footprint[0]!.y - MAX_DRAWN_LIFT * RISE,
      6,
    );
  });

  /** The drawing is capped; what the building does to the garden's light is not. */
  it('still casts its shadow from the real eaves', () => {
    const house = rectangleHouse({ x: 10, y: 3 }, 8, 5);
    const built = buildRenderScene(
      { ...scene([]), house },
      { view: 'visualise', light: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
    );

    const occluder = built.shadows.occluders.find((candidate) => candidate.height > MAX_DRAWN_LIFT);
    expect(occluder?.height).toBeCloseTo(houseHeight(house), 6);
  });

  /**
   * The rule the whole render directory rests on, checked where it would be easiest to break: the
   * walls are derived from the footprint and the footprint is handed back untouched. A house that
   * fits must never be refused because of something the renderer drew on it.
   */
  it('leaves the footprint exactly as the document has it', () => {
    const house = rectangleHouse({ x: 10, y: 3 }, 8, 5);
    const built = visualise([], { house });
    const node = find(built.stack, 'house')!;
    if (node.kind !== 'house') throw new Error('not a house');

    expect(node.walls.footprint).toEqual(built.house!.outline);
    expect(node.house.house).toBe(house);
  });

  it('has nothing to draw without a house', () => {
    expect(find(visualise([]).stack, 'house')).toBeUndefined();
  });
});
