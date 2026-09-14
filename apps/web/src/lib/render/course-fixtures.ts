import type { DesignElement, Point } from '@garden-studio/schema';

/** Authored-world prototype runs. Reused by the browser sheet and geometry tests. */
export const COURSE_FIXTURES: { id: string; points: Point[]; width: number; material: string }[] = [
  { id: 'straight', points: [{ x: 1, y: 1 }, { x: 8, y: 1 }], width: 0.22, material: 'brick-edging' },
  { id: 'circular', points: Array.from({ length: 65 }, (_, i) => ({
    x: 3 + Math.cos(i / 64 * Math.PI * 2) * 1.5, y: 4 + Math.sin(i / 64 * Math.PI * 2) * 1.5,
  })), width: 0.22, material: 'sett-edging' },
  { id: 'spline-like', points: Array.from({ length: 65 }, (_, i) => ({
    x: 6 + i / 64 * 6, y: 4 + Math.sin(i / 64 * Math.PI * 2) * 1.2,
  })), width: 0.3, material: 'concrete-kerb' },
  { id: 'concave', points: [{ x: 1, y: 8 }, { x: 4, y: 8 }, { x: 4, y: 6.5 }, { x: 6, y: 6.5 }, { x: 6, y: 8 }],
    width: 0.22, material: 'brick-edging' },
  { id: 'acute', points: [{ x: 8, y: 7 }, { x: 12, y: 7 }, { x: 8.7, y: 8.2 }], width: 0.22, material: 'brick-edging' },
  { id: 'short-end', points: [{ x: 1, y: 10 }, { x: 1.04, y: 10 }], width: 0.22, material: 'brick-edging' },
  { id: 'sleeper-corner', points: [{ x: 3, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 12 }], width: 0.2, material: 'timber-sleeper' },
  { id: 'multi-row', points: [{ x: 8, y: 11 }, { x: 10, y: 11 }, { x: 12, y: 13 }], width: 0.65, material: 'sett-edging' },
];

export function courseFixtureElements(): DesignElement[] {
  const runs: DesignElement[] = COURSE_FIXTURES.map(({ id, points, width, material }) => ({
    id: `prototype-${id}`, role: 'feature', category: 'paved-area', zone: 'back', material,
    shape: { kind: 'polyline', points: structuredClone(points), width },
  }));
  // The x=3 seam must be emitted once by edgingRuns, not once per neighbouring host.
  return [...runs, ...[2, 4].map((x): DesignElement => ({
    id: `prototype-shared-${x}`, role: 'feature', category: 'paved-area', zone: 'back',
    material: 'stone-pavers', edging: 'brick-edging',
    shape: { kind: 'rect', centre: { x, y: 13 }, width: 2, depth: 2, rotation: 0 },
  }))];
}
