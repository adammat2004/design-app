import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  authoredSideCount,
  distanceAlongSide,
  runPolyline,
  sideChains,
  spanOfRun,
} from './side-chains.js';
import type { PlanGeometry } from '../features.js';

const rect = (width: number, depth: number, rotation = 0): PlanGeometry => ({
  kind: 'rect',
  centre: { x: 10, y: 10 },
  width,
  depth,
  rotation,
});

const square: PlanGeometry = {
  kind: 'polygon',
  cornerRadius: 0,
  points: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
};

describe('sideChains', () => {
  it('gives a rectangle four sides in a rotation-stable order', () => {
    for (const rotation of [0, 37, 90, 180]) {
      const chains = sideChains(rect(6, 2, rotation));
      expect(chains).toHaveLength(4);
      // Top and bottom are the width; the flanks are the depth, whatever the angle.
      expect(chains.map((chain) => Math.round(chain.length * 1000) / 1000)).toEqual([6, 2, 6, 2]);
    }
  });

  it('keeps a side the same physical side through a resize', () => {
    const narrow = sideChains(rect(6, 2))[0]!;
    const wide = sideChains(rect(10, 2))[0]!;
    // Side 0 is still the top edge: same y, longer.
    expect(narrow.points[0]!.y).toBeCloseTo(wide.points[0]!.y, 9);
    expect(wide.length).toBeCloseTo(10, 9);
  });

  it('gives a rounded polygon one chain per corner, each curving at both ends', () => {
    const rounded = { ...square, cornerRadius: 0.5 } as PlanGeometry;
    const chains = sideChains(rounded);
    expect(chains).toHaveLength(4);

    // A straight run plus a half-arc at each end: more than two points, longer than the straight.
    for (const chain of chains) {
      expect(chain.points.length).toBeGreaterThan(2);
      expect(chain.length).toBeGreaterThan(3);
      expect(chain.length).toBeLessThan(4);
    }

    // The chains abut: each ends where the next begins.
    for (let i = 0; i < 4; i += 1) {
      const end = chains[i]!.points.at(-1)!;
      const start = chains[(i + 1) % 4]!.points[0]!;
      expect(end.x).toBeCloseTo(start.x, 9);
      expect(end.y).toBeCloseTo(start.y, 9);
    }
  });

  it('gives a path two sides and leaves its ends out', () => {
    const path: PlanGeometry = {
      kind: 'polyline',
      width: 1,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    };
    const chains = sideChains(path);
    expect(authoredSideCount(path)).toBe(2);
    expect(chains.map((chain) => chain.length)).toEqual([5, 5]);
  });

  it('gives a circular bed one closed chain', () => {
    const circle: PlanGeometry = { kind: 'point', at: { x: 0, y: 0 }, radius: 2 };
    const [chain] = sideChains(circle);
    expect(chain!.closed).toBe(true);
    expect(chain!.points[0]).toEqual(chain!.points.at(-1));
  });
});

describe('runs along a side', () => {
  const top = sideChains(rect(6, 2))[0]!;

  it('stores a run near the start as metres from the start', () => {
    expect(anchorFor(top, 0.5, 2.8)).toEqual({ anchor: 'start', from: 0.5, to: 2.8 });
  });

  it('stores a run near the far end as metres from that end', () => {
    const stored = anchorFor(top, 4, 5.5);
    expect(stored.anchor).toBe('end');
    expect(stored.from).toBeCloseTo(0.5, 9);
    expect(stored.to).toBeCloseTo(2, 9);
  });

  it('keeps each run with its own corner when the side is stretched', () => {
    const near = anchorFor(top, 0.5, 2.8);
    const far = anchorFor(top, 4, 5.5);
    const stretched = sideChains(rect(10, 2))[0]!;

    // The near run stays 0.5–2.8 m from the start; the far one stays 0.5–2 m from the end.
    expect(spanOfRun(stretched, near)).toEqual({ from: 0.5, to: 2.8 });
    const moved = spanOfRun(stretched, far)!;
    expect(moved.from).toBeCloseTo(8, 9);
    expect(moved.to).toBeCloseTo(9.5, 9);
    // Bought by the metre: both runs are the length they were.
    expect(moved.to - moved.from).toBeCloseTo(1.5, 9);
  });

  it('refuses a run its side has shrunk out from under, without losing it', () => {
    const run = { anchor: 'start' as const, from: 5, to: 5.8 };
    const shrunk = sideChains(rect(4, 2))[0]!;
    expect(spanOfRun(shrunk, run)).toBeNull();
    // The same stored run resolves again once the side is long enough.
    expect(spanOfRun(top, run)).not.toBeNull();
  });

  it('cuts a run out of the side, and projects a pointer back onto it', () => {
    const points = runPolyline(top, 1, 3);
    expect(points).toHaveLength(2);
    expect(Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)).toBeCloseTo(2, 9);

    // A pointer dragged a metre off into the garden still lands on the side.
    const off = { x: points[0]!.x, y: points[0]!.y - 1 };
    expect(distanceAlongSide(top, off)).toBeCloseTo(1, 9);
  });
});
