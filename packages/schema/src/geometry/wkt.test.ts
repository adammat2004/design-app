import { describe, expect, it } from 'vitest';
import { polygonEdges } from './primitives.js';
import { rectToPolygon } from './shapes.js';
import { lineToWkt, polygonToWkt } from './wkt.js';

const rectangle = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

describe('WKT formatting', () => {
  it('closes the polygon ring', () => {
    expect(polygonToWkt(rectangle)).toBe(
      'POLYGON((0.000000 0.000000, 10.000000 0.000000, 10.000000 8.000000, 0.000000 8.000000, 0.000000 0.000000))',
    );
  });

  it('never emits exponent notation for near-zero rotation artefacts', () => {
    const wkt = polygonToWkt(
      rectToPolygon({ centre: { x: 2, y: 1 }, width: 4, depth: 2, rotation: 90 }),
    );

    expect(wkt).not.toContain('e-');
    expect(wkt).not.toContain('e+');
  });

  it('writes a line between two points', () => {
    expect(lineToWkt({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(
      'LINESTRING(0.000000 0.000000, 10.000000 0.000000)',
    );
  });
});

describe('polygonEdges', () => {
  it('wraps the final edge back to the first vertex', () => {
    const edges = polygonEdges(rectangle);

    expect(edges).toHaveLength(4);
    expect(edges[0]).toEqual({ index: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(edges[3]!.end).toEqual({ x: 0, y: 0 });
  });
});
