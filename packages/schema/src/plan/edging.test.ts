import { describe, expect, it } from 'vitest';
import { edgingLength, edgingRuns, type EdgingRun } from './edging.js';
import type { DesignElement } from './concepts.js';

const PLOT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

function bed(id: string, points: { x: number; y: number }[], over: Partial<DesignElement> = {}) {
  return {
    id,
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    material: 'mixed-border',
    zone: 'back',
    edging: 'brick-edging',
    shape: { kind: 'polygon', cornerRadius: 0, points },
    ...over,
  } as DesignElement;
}

/** Total metres of every run, whatever the material. */
const total = (runs: EdgingRun[]) => runs.reduce((sum, run) => sum + run.length, 0);

describe('edgingRuns', () => {
  it('edges every side of a bed standing clear of everything', () => {
    const island = bed('b1', [
      { x: 5, y: 5 },
      { x: 9, y: 5 },
      { x: 9, y: 8 },
      { x: 5, y: 8 },
    ]);

    const runs = edgingRuns([island], { boundary: PLOT });

    // One closed run, not four sides: a course round a bed is continuous.
    expect(runs).toHaveLength(1);
    expect(total(runs)).toBeCloseTo(14, 6);
    expect(runs.every((run) => run.hostId === 'b1')).toBe(true);
    expect(runs.every((run) => run.material === 'brick-edging')).toBe(true);
  });

  it('does not edge the side that lies along the fence', () => {
    /*
     * The rule this whole module exists for. A border runs to the boundary, and a course buried in
     * the fence line is edging nobody can see and nobody would lay — but it would be ordered.
     */
    const border = bed('b1', [
      { x: 0, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 9 },
      { x: 0, y: 9 },
    ]);

    const runs = edgingRuns([border], { boundary: PLOT });

    // One open run round three sides of a 4 x 4 bed; the fourth is on the fence at x = 0.
    expect(runs).toHaveLength(1);
    expect(total(runs)).toBeCloseTo(12, 6);
    // Its two ends stop at the fence rather than running along it.
    expect(runs[0]!.points.filter((point) => point.x === 0)).toHaveLength(2);
  });

  it('does not edge the side against the house', () => {
    const house = [
      { x: 8, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 6 },
      { x: 8, y: 6 },
    ];
    const against = bed('b1', [
      { x: 8, y: 6 },
      { x: 14, y: 6 },
      { x: 14, y: 9 },
      { x: 8, y: 9 },
    ]);

    const runs = edgingRuns([against], { boundary: PLOT, house });

    expect(runs).toHaveLength(1);
    expect(total(runs)).toBeCloseTo(12, 6);
  });

  it('edges a seam between two edged beds once, not twice', () => {
    /*
     * Two beds meeting along a line have one course between them. Without this the schedule
     * double-counts every internal seam, which is the sort of error nobody spots because the
     * drawing looks right — the two runs are exactly on top of each other.
     */
    const left = bed('b1', [
      { x: 5, y: 5 },
      { x: 9, y: 5 },
      { x: 9, y: 9 },
      { x: 5, y: 9 },
    ]);
    const right = bed('b2', [
      { x: 9, y: 5 },
      { x: 13, y: 5 },
      { x: 13, y: 9 },
      { x: 9, y: 9 },
    ]);

    const runs = edgingRuns([left, right], { boundary: PLOT });

    // The first bed closes all the way round; the second is left with three sides as one run.
    expect(total(runs)).toBeCloseTo(28, 6);
    expect(runs.filter((run) => run.hostId === 'b2')).toHaveLength(1);
    expect(total(runs.filter((run) => run.hostId === 'b2'))).toBeCloseTo(12, 6);
  });

  it('ignores a host that has not been given an edging', () => {
    const plain = bed('b1', [
      { x: 5, y: 5 },
      { x: 9, y: 5 },
      { x: 9, y: 8 },
      { x: 5, y: 8 },
    ]);
    delete (plain as { edging?: string }).edging;

    expect(edgingRuns([plain], { boundary: PLOT })).toEqual([]);
  });

  it('ignores an edging on a category that cannot carry one', () => {
    // A pergola is not a surface, so "edged in brick" is not a thing it can be.
    const structure = bed(
      'b1',
      [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
        { x: 9, y: 8 },
        { x: 5, y: 8 },
      ],
      { category: 'structure' },
    );

    expect(edgingRuns([structure], { boundary: PLOT })).toEqual([]);
  });

  it('ignores a material that is not an edging product', () => {
    // The field is a plain string, like `material`, so a stored plan cannot fail to parse — which
    // means a nonsense value has to be refused here rather than by the schema.
    const wrong = bed(
      'b1',
      [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
        { x: 9, y: 8 },
        { x: 5, y: 8 },
      ],
      { edging: 'standard-turf' },
    );

    expect(edgingRuns([wrong], { boundary: PLOT })).toEqual([]);
  });

  it('ignores a hidden host', () => {
    const gone = bed(
      'b1',
      [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
        { x: 9, y: 8 },
        { x: 5, y: 8 },
      ],
      { hidden: true },
    );

    expect(edgingRuns([gone], { boundary: PLOT })).toEqual([]);
  });

  it('edges a bed held off the fence by a mowing gap', () => {
    /*
     * The other side of the tolerance, and the reason it is 60 mm rather than something generous:
     * a bed deliberately set back from the boundary is a different thing from one running up to
     * it, and the gap a designer draws is never centimetres.
     */
    const held = bed('b1', [
      { x: 0.4, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 9 },
      { x: 0.4, y: 9 },
    ]);

    expect(edgingRuns([held], { boundary: PLOT })).toHaveLength(1);
    expect(total(edgingRuns([held], { boundary: PLOT }))).toBeCloseTo(15.2, 6);
  });

  it('joins a tessellated outline into one run rather than one per segment', () => {
    /*
     * The failure this prevents is visible as well as numerical. A curved bed is tessellated at two
     * dozen points, so a run per segment would report "24 runs" for one bed — and `polylineStrip`
     * cuts its caps square, so two dozen stubby strips leave a notch at every vertex right round
     * the curve. One polyline mitres those joints instead.
     */
    const circle = bed(
      'b1',
      Array.from({ length: 24 }, (_, i) => ({
        x: 10 + 3 * Math.cos((i / 24) * Math.PI * 2),
        y: 10 + 3 * Math.sin((i / 24) * Math.PI * 2),
      })),
    );

    const runs = edgingRuns([circle], { boundary: PLOT });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.points.length).toBeGreaterThan(20);
    // A 24-gon inscribed in a 3 m circle: just under the 18.85 m circumference.
    expect(runs[0]!.length).toBeCloseTo(18.8, 1);
    expect(runs[0]!.length).toBeLessThan(2 * Math.PI * 3);
  });

  it('carries a run across the start of the ring rather than splitting it there', () => {
    /*
     * The wrap. A ring is walked from an arbitrary index, so a course that happens to pass through
     * that index would come back as two runs meeting end to end — which draws two square caps
     * butting into each other in the middle of an otherwise continuous edge.
     */
    const gapAtSide = bed('b1', [
      { x: 0, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 9 },
      { x: 0, y: 9 },
    ]);

    // The excluded side is the last segment of the ring, so what is kept wraps past index 0.
    const runs = edgingRuns([gapAtSide], { boundary: PLOT });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.points).toHaveLength(4);
  });

  it('is a pure function of its input', () => {
    const elements = [
      bed('b1', [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
        { x: 9, y: 8 },
        { x: 5, y: 8 },
      ]),
    ];
    const before = structuredClone(elements);

    expect(edgingRuns(elements, { boundary: PLOT })).toEqual(
      edgingRuns(elements, { boundary: PLOT }),
    );
    expect(elements).toEqual(before);
  });

  it('sums by material, which is what the schedule prints', () => {
    const brick = bed('b1', [
      { x: 5, y: 5 },
      { x: 9, y: 5 },
      { x: 9, y: 8 },
      { x: 5, y: 8 },
    ]);
    const steel = bed(
      'b2',
      [
        { x: 12, y: 5 },
        { x: 16, y: 5 },
        { x: 16, y: 8 },
        { x: 12, y: 8 },
      ],
      { edging: 'steel-edging' },
    );

    const runs = edgingRuns([brick, steel], { boundary: PLOT });

    expect(edgingLength(runs, 'brick-edging')).toBeCloseTo(14, 6);
    expect(edgingLength(runs, 'steel-edging')).toBeCloseTo(14, 6);
    expect(edgingLength(runs, 'concrete-kerb')).toBe(0);
  });
});
