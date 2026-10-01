import { describe, expect, it } from 'vitest';
import { boundaryRuns } from './boundary-styles.js';
import type { DesignElement } from './concepts.js';
import { enclosureKindNamed } from './enclosure.js';
import { effectiveBoundaryRuns, kerbLines } from './enclosures.js';
import { elementIsLegal } from './footprint.js';
import { heightFor } from './heights.js';

/** A 10 × 8 plot, drawn clockwise from the top-left. */
const site = {
  vertices: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 10, y: 8 },
    { id: 'd', x: 0, y: 8 },
  ],
  boundaryStyles: [],
};
const ring = site.vertices.map(({ x, y }) => ({ x, y }));

function enclosure(id: string, points: { x: number; y: number }[], over: Partial<DesignElement> = {}): DesignElement {
  return {
    id,
    category: 'enclosure',
    role: 'feature',
    zone: 'back',
    material: 'slatted-screen',
    enclosure: { kind: 'screen' },
    shape: { kind: 'polyline', points, width: 0.08 },
    ...over,
  };
}

describe('effectiveBoundaryRuns', () => {
  it('is the survey exactly, when nothing is proposed', () => {
    const effective = effectiveBoundaryRuns(site, []);
    expect(effective.survey.map(({ id: _id, ...run }) => run)).toEqual(boundaryRuns(site));
    expect(effective.replaced).toEqual([]);
    expect(effective.proposed).toEqual([]);
  });

  it('cuts the stretch a screen lies along out of its side, and draws the screen there instead', () => {
    // Along the top side from 2 m to 6 m, a hand's width inside the fence.
    const screen = enclosure('s', [{ x: 2, y: 0.1 }, { x: 6, y: 0.1 }]);
    const { survey, replaced, proposed } = effectiveBoundaryRuns(site, [screen]);

    const top = survey.filter((run) => run.edgeVertexId === 'a');
    expect(top.map((run) => run.length)).toEqual([expect.closeTo(2), expect.closeTo(4)]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.length).toBeCloseTo(4);

    expect(proposed).toHaveLength(1);
    const run = proposed[0]!;
    expect(run).toMatchObject({ kind: 'screen', sourceId: 's', height: 1.8 });
    // Laid on the fence line, band inward — where the old fence stood.
    expect(run.start.y).toBeCloseTo(0);
    expect(run.inward!.y).toBeCloseTo(1);
  });

  it('leaves the survey alone for a wall across the middle, and centres the wall on its line', () => {
    const wall = enclosure('w', [{ x: 2, y: 4 }, { x: 8, y: 4 }], {
      material: 'brick-garden-wall',
      enclosure: { kind: 'wall' },
      shape: { kind: 'polyline', points: [{ x: 2, y: 4 }, { x: 8, y: 4 }], width: 0.22 },
    });
    const { survey, replaced, proposed } = effectiveBoundaryRuns(site, [wall]);
    expect(survey).toHaveLength(4);
    expect(replaced).toEqual([]);
    const run = proposed[0]!;
    const middle = run.start.y + (run.inward!.y * run.thickness) / 2;
    expect(middle).toBeCloseTo(4);
  });

  it('opens a side with an opening, and lays a kerb as an edging course rather than a boundary', () => {
    const open = enclosure('o', [{ x: 0, y: 8 }, { x: 10, y: 8 }], { material: 'open-boundary', enclosure: { kind: 'open' } });
    const kerb = enclosure('k', [{ x: 1, y: 2 }, { x: 1, y: 6 }], { material: 'kerb-line', enclosure: { kind: 'kerb' } });
    const { survey, proposed } = effectiveBoundaryRuns(site, [open, kerb]);
    expect(survey.some((run) => run.edgeVertexId === 'c')).toBe(false);
    expect(proposed.map((run) => run.kind)).toEqual(['open']);
    expect(kerbLines([open, kerb]).map((line) => line.id)).toEqual(['k']);
  });
});

describe('an enclosure is judged on its line', () => {
  it('may stand exactly on the fence line, and may not leave the plot', () => {
    expect(elementIsLegal(enclosure('on', [{ x: 0, y: 0 }, { x: 10, y: 0 }]), ring)).toBe(true);
    expect(elementIsLegal(enclosure('out', [{ x: 5, y: 4 }, { x: 12, y: 4 }]), ring)).toBe(false);
  });

  it('takes its height from what it is built of', () => {
    expect(heightFor(enclosure('w', [], { material: 'brick-garden-wall' }))).toBe(1.2);
    expect(heightFor(enclosure('w', [], { material: 'brick-garden-wall', height: 2 }))).toBe(2);
  });
});

describe('enclosureKindNamed', () => {
  it('reads the kind a sentence means, the particular word first', () => {
    expect(enclosureKindNamed('a slatted screen fence')).toBe('screen');
    expect(enclosureKindNamed('beech hedging')).toBe('hedge');
    expect(enclosureKindNamed('a low brick wall')).toBe('wall');
    expect(enclosureKindNamed('fence panels')).toBe('fence');
    expect(enclosureKindNamed('no fence here')).toBe('open');
    expect(enclosureKindNamed('a fountain')).toBeNull();
  });
});
