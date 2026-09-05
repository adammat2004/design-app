import { describe, expect, it } from 'vitest';
import { pointInPolygon, type Point } from '../geometry/primitives.js';
import { geometryOutline } from './features.js';
import { GATE_THRESHOLD_DEPTH, type Gate } from './gate.js';
import {
  clampOffsetToEdge,
  fitsOnEdge,
  gateCentre,
  gateNormal,
  gateSegment,
  gateSide,
  gateThresholdRect,
  resolvedGates,
  streetEdge,
  streetOutward,
  suggestedAccess,
  suggestedGateEdge,
  suggestedStreetEdge,
} from './gates.js';
import { rectangleHouse, SiteSectionSchema, type SiteSection } from './site.js';

/**
 * A 20 × 16 m plot, corners v1 (0,0) → v2 (20,0) → v3 (20,16) → v4 (0,16), clockwise on screen.
 * The house sits near the top at rotation 0, so it faces +y: the street is the bottom edge
 * (v3 → v4), the back garden is above the house, and the right return (v2 → v3) is the wider one.
 */
function site(overrides: Partial<SiteSection> = {}): SiteSection {
  return SiteSectionSchema.parse({
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 20, y: 0 },
      { id: 'v3', x: 20, y: 16 },
      { id: 'v4', x: 0, y: 16 },
    ],
    closed: true,
    house: rectangleHouse({ x: 8, y: 11 }, 8, 6),
    ...overrides,
  });
}

const gate = (overrides: Partial<Gate> = {}): Gate => ({
  id: 'g1',
  edgeVertexId: 'v2',
  offsetAlongEdge: 6,
  width: 0.9,
  ...overrides,
});

describe('gateSegment', () => {
  it('runs along the edge from the start vertex', () => {
    const [from, to] = gateSegment(site(), gate())!;
    expect(from).toEqual({ x: 20, y: 5.55 });
    expect(to).toEqual({ x: 20, y: 6.45 });
  });

  it('is null for a vertex that no longer exists', () => {
    expect(gateSegment(site(), gate({ edgeVertexId: 'v9' }))).toBeNull();
  });

  it('is null when the gate overruns a shortened edge', () => {
    expect(gateSegment(site(), gate({ offsetAlongEdge: 15.9 }))).toBeNull();
  });

  it('moves with the fence when a corner is dragged', () => {
    const dragged = site();
    dragged.vertices[2] = { id: 'v3', x: 22, y: 16 };
    const centre = gateCentre(dragged, gate())!;
    // Still 6 m along the (now sloping) edge from v2, and on it.
    expect(Math.hypot(centre.x - 20, centre.y)).toBeCloseTo(6, 6);
  });
});

describe('gateNormal', () => {
  it('points into the garden on a clockwise outline', () => {
    expect(gateNormal(site(), gate())).toEqual({ x: -1, y: 0 });
  });

  it('points into the garden on a reversed outline too', () => {
    const reversed = site();
    reversed.vertices = [...reversed.vertices].reverse();
    // The right edge now starts at v3 and runs down to v2.
    const normal = gateNormal(reversed, gate({ edgeVertexId: 'v3' }))!;
    expect(normal.x).toBeCloseTo(-1);
    expect(normal.y).toBeCloseTo(0);
  });
});

describe('gateThresholdRect', () => {
  it('starts at the fence and reaches into the garden', () => {
    const rect = gateThresholdRect(site(), gate(), GATE_THRESHOLD_DEPTH)!;
    const outline = geometryOutline(rect);
    const boundary = site().vertices.map(({ x, y }) => ({ x, y }));
    for (const point of outline) {
      expect(point.x).toBeLessThanOrEqual(20 + 1e-9);
      expect(point.x).toBeGreaterThanOrEqual(19 - 1e-9);
    }
    expect(pointInPolygon({ x: 19.5, y: 6 }, boundary)).toBe(true);
  });
});

describe('fitsOnEdge and clampOffsetToEdge', () => {
  it('refuses a gate through another gate, allows one touching it', () => {
    const s = site({ gates: [gate()] });
    expect(fitsOnEdge(s, gate({ id: 'g2', offsetAlongEdge: 6.5 }))).toBe(false);
    expect(fitsOnEdge(s, gate({ id: 'g2', offsetAlongEdge: 6.9 }))).toBe(true);
  });

  it('keeps a gate wholly on its edge', () => {
    expect(clampOffsetToEdge(site(), 'v2', 0.9, 0)).toBeCloseTo(0.45);
    expect(clampOffsetToEdge(site(), 'v2', 0.9, 99)).toBeCloseTo(15.55);
    expect(clampOffsetToEdge(site(), 'v9', 0.9, 1)).toBeNull();
  });
});

describe('the street', () => {
  it('suggests the fence in front of the house that faces the way the house does', () => {
    expect(suggestedStreetEdge(site())).toBe('v3');
  });

  it('follows the house round', () => {
    const turned = site({ house: { ...rectangleHouse({ x: 10, y: 8 }, 8, 6), rotation: 90 } });
    // Facing +y turned 90° clockwise faces -x: the left fence, v4 → v1.
    expect(suggestedStreetEdge(turned)).toBe('v4');
  });

  it('resolves the chosen edge and its outward direction', () => {
    const s = site({ streetEdgeVertexId: 'v3' });
    expect(streetEdge(s)).toEqual([
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ]);
    expect(streetOutward(s)).toEqual({ x: 0, y: 1 });
    expect(streetEdge(site())).toBeNull();
  });
});

describe('the side gate', () => {
  it('goes on the wider return, just behind the back wall', () => {
    const suggestion = suggestedGateEdge(site())!;
    expect(suggestion.edgeVertexId).toBe('v2');
    // Back wall at y = 8, so a metre behind it is y = 7: 7 m along v2 → v3.
    expect(suggestion.offsetAlongEdge).toBeCloseTo(7);
  });

  it('knows which side of the house a gate is on', () => {
    const s = site();
    expect(gateSide(s, gate(), s.house!)).toBe('right');
    expect(gateSide(s, gate({ edgeVertexId: 'v4', offsetAlongEdge: 8 }), s.house!)).toBe('left');
  });

  it('lists only the gates that resolve', () => {
    const s = site({ gates: [gate(), gate({ id: 'g2', edgeVertexId: 'v9' })] });
    expect(resolvedGates(s).map((entry) => entry.gate.id)).toEqual(['g1']);
  });

  it('is absent from a stored plan that predates it, and parses', () => {
    const parsed = SiteSectionSchema.parse({ vertices: [], closed: false, house: null });
    expect(parsed.gates).toEqual([]);
    expect(parsed.streetEdgeVertexId).toBeNull();
    expect(suggestedGateEdge(parsed)).toBeNull();
  });
});

describe('suggestedAccess', () => {
  it('fills in the street, both doors and a gate on a bare site', () => {
    const s = suggestedAccess(site());

    expect(s.streetEdgeVertexId).toBe('v3');
    const types = s.house!.openings.map((opening) => opening.type).sort();
    expect(types).toEqual(['front-door', 'patio-door']);
    // The patio door faces away from the street, the front door towards it.
    const patio = s.house!.openings.find((opening) => opening.type === 'patio-door')!;
    const front = s.house!.openings.find((opening) => opening.type === 'front-door')!;
    expect(patio.wallId).not.toBe(front.wallId);
    expect(s.gates).toHaveLength(1);
    expect(s.gates[0]!.edgeVertexId).toBe('v2');
  });

  it('keeps what the user has already placed and only fills the gaps', () => {
    const chosen = site({
      streetEdgeVertexId: 'v1',
      gates: [gate({ edgeVertexId: 'v4', offsetAlongEdge: 4 })],
    });
    const s = suggestedAccess(chosen);

    expect(s.streetEdgeVertexId).toBe('v1');
    expect(s.gates).toEqual(chosen.gates);
    // With the street along the top, the garden is below the house and the doors follow.
    expect(s.house!.openings).toHaveLength(2);
    const again = suggestedAccess(s);
    expect(again.house!.openings).toEqual(s.house!.openings);
  });

  it('does nothing without a house', () => {
    const s = site({ house: null });
    expect(suggestedAccess(s)).toBe(s);
  });
});

/** Kept for a reader checking the frame: +y is down the screen, so "in front" of the house is +y. */
export type { Point };
