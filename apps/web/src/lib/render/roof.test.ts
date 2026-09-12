import { describe, expect, it } from 'vitest';
import { distanceToEdge, geometryOutline, pointInPolygon, polygonArea } from '@garden-studio/schema';
import { roofFor } from './roof';

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
