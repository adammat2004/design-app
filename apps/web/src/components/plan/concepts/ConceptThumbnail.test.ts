import type { GeneratedConcept } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { rectangleHouse } from '@/lib/house';
import { conceptThumbnailGeometry } from './ConceptThumbnail';

const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

const HOUSE = rectangleHouse({ x: 10, y: 8 }, 8, 6);

/**
 * A hand-written concept rather than a generated one.
 *
 * Generation runs on the server now, and this test is about the projection anyway — a fixture that
 * covers all four geometry kinds and the fills-then-features order tests it more precisely than a
 * roll of the generator did, and without needing a database.
 */
function concept(): GeneratedConcept {
  return {
    id: 'c3-0',
    name: 'Balanced Everyday Garden',
    recommended: true,
    summary: 'Answers the brief as written.',
    style: 'Modern / Natural',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [
      { feature: 'seating', label: 'Seating / dining area', included: true },
    ],
    elements: [
      {
        id: 'c3-0-e1',
        category: 'lawn',
        role: 'fill',
        fillKind: 'base',
        zone: 'front',
        shape: {
          kind: 'polygon',
          cornerRadius: 0,
          points: [
            { x: 0, y: 11 },
            { x: 20, y: 11 },
            { x: 20, y: 16 },
            { x: 0, y: 16 },
          ],
        },
      },
      {
        id: 'c3-0-e2',
        category: 'planting-bed',
        role: 'fill',
        fillKind: 'accent',
        zone: 'front',
        shape: {
          kind: 'polygon',
          cornerRadius: 0.5,
          points: [
            { x: 1, y: 12 },
            { x: 6, y: 12 },
            { x: 6, y: 15 },
            { x: 1, y: 15 },
          ],
        },
      },
      {
        id: 'c3-0-e3',
        category: 'paved-area',
        role: 'feature',
        name: 'Seating patio',
        zone: 'front',
        shape: { kind: 'rect', centre: { x: 14, y: 13 }, width: 5.2, depth: 3.8, rotation: 0 },
      },
      {
        id: 'c3-0-e4',
        category: 'water-feature',
        role: 'feature',
        name: 'Water feature',
        zone: 'front',
        shape: { kind: 'point', at: { x: 4, y: 13 }, radius: 0.9 },
      },
      {
        id: 'c3-0-e5',
        category: 'paved-area',
        role: 'feature',
        name: 'Service path',
        zone: 'front',
        shape: {
          kind: 'polyline',
          width: 1.2,
          points: [
            { x: 10, y: 11 },
            { x: 14, y: 13 },
          ],
        },
      },
    ],
  };
}

describe('conceptThumbnailGeometry', () => {
  it('has nothing to draw without a property', () => {
    expect(conceptThumbnailGeometry(concept(), [], null)).toBeNull();
    expect(conceptThumbnailGeometry(concept(), [{ x: 0, y: 0 }], null)).toBeNull();
  });

  it('draws the property even before a concept exists', () => {
    const plan = conceptThumbnailGeometry(null, BOUNDARY, HOUSE);

    expect(plan?.outline).toBeTruthy();
    expect(plan?.house).toBeTruthy();
    expect(plan?.shapes).toEqual([]);
  });

  it('projects one shape per element, in the same order', () => {
    const chosen = concept();
    const plan = conceptThumbnailGeometry(chosen, BOUNDARY, HOUSE);

    expect(plan?.shapes.map((shape) => shape.id)).toEqual(
      chosen.elements.map((element) => element.id),
    );
  });

  it('fits everything inside the viewBox', () => {
    const plan = conceptThumbnailGeometry(concept(), BOUNDARY, HOUSE);

    for (const pair of plan!.outline.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(240);
      expect(y).toBeLessThanOrEqual(132);
    }
  });

  it('picks the right SVG primitive per geometry kind', () => {
    const chosen = concept();
    const plan = conceptThumbnailGeometry(chosen, BOUNDARY, HOUSE);

    chosen.elements.forEach((element, index) => {
      const shape = plan!.shapes[index];
      const expected =
        element.shape.kind === 'point'
          ? 'circle'
          : element.shape.kind === 'polyline'
            ? 'line'
            : 'polygon';

      expect(shape.kind).toBe(expected);
    });
  });

  it('gives round elements a centre and a radius rather than points', () => {
    const chosen = concept();
    const plan = conceptThumbnailGeometry(chosen, BOUNDARY, HOUSE);
    const circles = plan!.shapes.filter((shape) => shape.kind === 'circle');

    for (const circle of circles) {
      expect(circle.centre).toBeDefined();
      expect(circle.radius).toBeGreaterThan(0);
    }
  });

  /**
   * The card and the canvas must never disagree about which garden they are showing, so both
   * read the same element order. Fills first is what puts ground cover under the features.
   */
  it('keeps fills ahead of features, as the canvas does', () => {
    const chosen = concept();
    const plan = conceptThumbnailGeometry(chosen, BOUNDARY, HOUSE);

    const roles = chosen.elements.map((element) => element.role);
    const lastFill = roles.lastIndexOf('fill');
    const firstFeature = roles.indexOf('feature');

    expect(lastFill).toBeLessThan(firstFeature);
    expect(plan!.shapes).toHaveLength(roles.length);
  });
});
