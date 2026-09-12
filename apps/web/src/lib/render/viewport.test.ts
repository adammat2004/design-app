import { describe, expect, it } from 'vitest';
import { boundingBox, PlanDocumentSchema, rectangleHouse, suggestedAccess } from '@garden-studio/schema';
import { fitPresentation, presentationExtent, zoomPresentation } from './viewport';

const boundary = [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 26 }, { x: 0, y: 26 }];
const site = suggestedAccess(PlanDocumentSchema.shape.site.parse({
  vertices: boundary.map((p, i) => ({ ...p, id: `v${i}` })), closed: true,
  house: rectangleHouse({ x: 9, y: 22 }, 10, 8), selectedZoneIds: ['back', 'left', 'right'],
}));
const scene = { boundary, house: site.house, elements: [], site };

describe('presentation viewport', () => {
  it('fits at 92% along the limiting dimension, with space for context', () => {
    const size = { width: 1400, height: 800 };
    const extent = presentationExtent(scene, 'garden');
    const box = boundingBox(extent);
    const view = fitPresentation(extent, size);
    expect(Math.max(box.width * view.pxPerMetre / size.width, box.length * view.pxPerMetre / size.height)).toBeCloseTo(0.92);
    expect(box.length).toBeLessThan(26);
    expect(presentationExtent(scene, 'plot')).toEqual(boundary);
  });
  it('keeps the cursor over the same world point at normal and clamped zoom', () => {
    const view = { pxPerMetre: 30, centre: { x: 8, y: 9 } };
    const cursor = { x: 130, y: -94 };
    for (const factor of [0.8, 1.25, 100, 0.001]) {
      const next = zoomPresentation(view, factor, cursor);
      expect(next.centre.x + cursor.x / next.pxPerMetre).toBeCloseTo(view.centre.x + cursor.x / view.pxPerMetre);
      expect(next.centre.y + cursor.y / next.pxPerMetre).toBeCloseTo(view.centre.y + cursor.y / view.pxPerMetre);
      expect(next.pxPerMetre).toBeGreaterThanOrEqual(4);
      expect(next.pxPerMetre).toBeLessThanOrEqual(400);
    }
  });
});
