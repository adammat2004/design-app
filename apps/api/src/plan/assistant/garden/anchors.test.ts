import {
  computeZones,
  pointInPolygon,
  PlanDocumentSchema,
  suggestedAccess,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { anchorPoint, buildAnchorContext } from './anchors.js';

/**
 * A 20 × 19 m plot with an 8 × 6 m house at (10, 7), rotation 180 — so the house faces -y, the
 * street is the top fence, and the back garden is the 9 m below the house. The same fixture the
 * concept suite uses, so "back-left" here means what it means there.
 */
function site(overrides: Record<string, unknown> = {}): SiteSection {
  return suggestedAccess(
    PlanDocumentSchema.shape.site.parse({
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 20, y: 0 },
        { id: 'v3', x: 20, y: 19 },
        { id: 'v4', x: 0, y: 19 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        centre: { x: 10, y: 7 },
        rotation: 180,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
      ...overrides,
    }),
  );
}

function context(overrides?: Record<string, unknown>) {
  const resolved = site(overrides);
  return buildAnchorContext(resolved, computeZones(resolved.vertices, resolved.house));
}

const boundary: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 19 },
  { x: 0, y: 19 },
];

describe('anchorPoint', () => {
  // Nothing may be aimed at a spot the plan does not own — the placer would only refuse it later.
  it('answers a point on the plot for every place it can name', () => {
    const anchors = [
      'back-left',
      'back-centre',
      'back-right',
      'mid-left',
      'centre',
      'mid-right',
      'front-left',
      'front-centre',
      'front-right',
      'along-left-fence',
      'along-right-fence',
      'along-back-fence',
      'outside-back-door',
      'outside-front-door',
      'beside-house-left',
      'beside-house-right',
    ] as const;

    for (const anchor of anchors) {
      const at = anchorPoint(anchor, context());
      expect(at, anchor).not.toBeNull();
      expect(pointInPolygon(at!, boundary), anchor).toBe(true);
    }
  });

  /*
   * The whole point of resolving in the door's frame rather than on screen. The house faces -y, so
   * the garden is +y and "back" has to be the far end of *that*, not the bottom of the picture.
   */
  it('puts the back of the garden away from the house, not down the screen', () => {
    const back = anchorPoint('back-centre', context())!;
    const front = anchorPoint('front-centre', context())!;

    expect(back.y).toBeGreaterThan(11);
    expect(back.y).toBeGreaterThan(front.y);
  });

  /*
   * The handedness, pinned, because it is the thing that is easy to get backwards and impossible
   * to spot afterwards — a plan with left and right swapped is a perfectly ordinary-looking plan.
   *
   * +y is *down* the page here, so the frame is left-handed compared to the usual maths one. This
   * house faces -y, so looking out of its garden doors you face +y — down the page — and your left
   * hand points to **+x**, the same way south-facing puts east on your left on any map. That is why
   * `DesignFrame.cross` is `(-axis.y, axis.x)` and points to -x here.
   */
  it('tells left from right as you look out of the doors', () => {
    const left = anchorPoint('back-left', context())!;
    const right = anchorPoint('back-right', context())!;

    expect(left.x).not.toBeCloseTo(right.x, 1);
    expect(left.x).toBeGreaterThan(right.x);
  });

  it('puts the door anchor just outside the doors rather than in the house', () => {
    const at = anchorPoint('outside-back-door', context())!;

    expect(at.y).toBeGreaterThan(10);
    expect(at.y).toBeLessThan(13);
    expect(at.x).toBeGreaterThan(6);
    expect(at.x).toBeLessThan(14);
  });

  it('keeps a fence anchor in from the fence rather than on it', () => {
    const right = anchorPoint('along-right-fence', context())!;
    const left = anchorPoint('along-left-fence', context())!;
    const back = anchorPoint('along-back-fence', context())!;

    // Same handedness as above: the right-hand fence standing at the doors is the one at x = 0.
    expect(right.x).toBeGreaterThan(0.5);
    expect(right.x).toBeLessThan(4);
    expect(left.x).toBeGreaterThan(16);
    expect(left.x).toBeLessThan(19.5);

    expect(back.y).toBeGreaterThan(15);
    expect(back.y).toBeLessThan(18.5);
  });

  /*
   * A rotated house is the case the frame exists for: the same phrase has to follow the building
   * round rather than staying where it was on screen.
   */
  it('follows the house round when it is rotated', () => {
    const upright = anchorPoint('back-centre', context())!;
    const turned = anchorPoint(
      'back-centre',
      context({
        house: {
          outline: [
            { id: 'h0', x: -4, y: -3 },
            { id: 'h1', x: 4, y: -3 },
            { id: 'h2', x: 4, y: 3 },
            { id: 'h3', x: -4, y: 3 },
          ],
          centre: { x: 10, y: 7 },
          rotation: 0,
        },
        streetEdgeVertexId: null,
      }),
    )!;

    expect(turned.y).not.toBeCloseTo(upright.y, 0);
  });

  // `null` rather than a guess — the rule openings.ts and gates.ts already set.
  it('refuses what it cannot know without a house', () => {
    const bare = context({ house: null, selectedZoneIds: [] });

    expect(anchorPoint('outside-back-door', bare)).toBeNull();
    expect(anchorPoint('beside-house-left', bare)).toBeNull();
    expect(anchorPoint('along-right-fence', bare)).toBeNull();
  });

  // But the plot's own quadrants are still answerable, and still have to land on the plot.
  it('still places the nine squares on a plan with no house', () => {
    const bare = context({ house: null, selectedZoneIds: [] });

    for (const anchor of ['back-left', 'centre', 'front-right'] as const) {
      const at = anchorPoint(anchor, bare);
      expect(at, anchor).not.toBeNull();
      expect(pointInPolygon(at!, boundary), anchor).toBe(true);
    }
  });
});
