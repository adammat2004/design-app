import { describe, expect, it } from 'vitest';
import { distanceToEdge } from './planting-sample.js';
import { geometryOutline } from './features.js';
import { pointInPolygon, polygonArea } from '../geometry/primitives.js';
import { ROOF_PITCH_SHARE, roofFor, roofSolid } from './roof.js';

describe('derived presentation roofs', () => {
  for (const rotation of [0, 37, 90, 180]) for (const width of [8, 14]) {
    it(`covers a ${width} m house at ${rotation}° without changing its footprint`, () => {
      const outline = geometryOutline({ kind: 'rect', centre: { x: 12, y: 9 }, width, depth: 8, rotation });
      const before = JSON.stringify(outline);
      const roof = roofFor(outline, { x: -Math.SQRT1_2, y: -Math.SQRT1_2 })!;
      expect(JSON.stringify(outline)).toBe(before);
      expect(roof.form).toBe(width === 8 ? 'hipped' : 'gable');
      expect(roof.planes.reduce((sum, plane) => sum + polygonArea(plane.outline), 0)).toBeCloseTo(polygonArea(outline), 6);
      for (const plane of roof.planes) for (const point of plane.outline)
        expect(pointInPolygon(point, outline) || distanceToEdge(point, outline) < 1e-7).toBe(true);
      expect(roof).toEqual(roofFor(outline, { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }));
    });
  }
  it('reverses plane lighting when the light reverses', () => {
    const outline = geometryOutline({ kind: 'rect', centre: { x: 0, y: 0 }, width: 12, depth: 7, rotation: 24 });
    const a = roofFor(outline, { x: 1, y: 0 })!;
    const b = roofFor(outline, { x: -1, y: 0 })!;
    expect(a.ridge).toEqual(b.ridge);
    a.planes.forEach((plane, i) => expect(plane.lit).toBeCloseTo(-b.planes[i]!.lit));
  });
});

describe('roofSolid', () => {
  it('pitches a turned house exactly as it pitches the same house square on', () => {
    // The span is the roof's own, not a bounding box in somebody's frame: turning a house must not
    // make its roof steeper.
    for (const rotation of [0, 30, 45, 90]) {
      const outline = geometryOutline({ kind: 'rect', centre: { x: 10, y: 10 }, width: 12, depth: 7, rotation });
      const solid = roofSolid(roofFor(outline, { x: -1, y: -1 })!, 6);
      expect(solid.rise).toBeCloseTo(7 * ROOF_PITCH_SHARE, 9);
      const heights = solid.planes.flat().map((point) => point.height);
      expect(Math.min(...heights)).toBeCloseTo(6, 9);
      expect(Math.max(...heights)).toBeCloseTo(6 + 7 * ROOF_PITCH_SHARE, 9);
      expect(solid.gables).toHaveLength(2);
    }
  });

  it('keeps a flat roof flat', () => {
    const tiny = geometryOutline({ kind: 'rect', centre: { x: 0, y: 0 }, width: 0.5, depth: 0.5, rotation: 0 });
    const roof = roofFor(tiny, { x: -1, y: -1 });
    if (roof?.form === 'flat') expect(roofSolid(roof, 3).rise).toBe(0);
  });
});
