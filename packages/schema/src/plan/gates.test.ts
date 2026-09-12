import { describe, expect, it } from 'vitest';
import { pointInPolygon, type Point } from '../geometry/primitives.js';
import { geometryOutline } from './features.js';
import { GATE_THRESHOLD_DEPTH, type Gate } from './gate.js';
import {
  accessAfterDelete,
  clampOffsetToEdge,
  firstFreeOffsetOnEdge,
  fitsOnEdge,
  gateCentre,
  gatesAfterSplit,
  gateNormal,
  gateSegment,
  gateSide,
  gateThresholdRect,
  resolvedGates,
  sidePathGate,
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
  kind: 'pedestrian',
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

describe('sidePathGate', () => {
  /*
   * The generator used to take `resolvedGates(site)[0]` — whichever gate was stored first — and
   * route the garden's side path from it. Harmless while every gate was a 900 mm pedestrian one;
   * wrong the moment a gap in the boundary can be a driveway or a street frontage.
   */
  it('takes the only gate when there is one', () => {
    const s = site({ gates: [gate()] });
    expect(sidePathGate(s)?.gate.id).toBe('g1');
  });

  it('prefers a pedestrian gate to a driveway, whatever the order they are stored in', () => {
    const drive = gate({
      id: 'g2',
      edgeVertexId: 'v4',
      offsetAlongEdge: 8,
      width: 3,
      kind: 'vehicle',
    });
    const walk = gate({ id: 'g3', edgeVertexId: 'v2', offsetAlongEdge: 6 });

    expect(sidePathGate(site({ gates: [drive, walk] }))?.gate.id).toBe('g3');
    expect(sidePathGate(site({ gates: [walk, drive] }))?.gate.id).toBe('g3');
  });

  /*
   * The front path already runs to the kerb. Starting the *back* garden's side path at the street
   * frontage would drag it through the front garden and past the house.
   */
  it('ignores a gate on the street edge', () => {
    const s = site({
      streetEdgeVertexId: 'v3',
      gates: [gate({ id: 'g2', edgeVertexId: 'v3', offsetAlongEdge: 10 })],
    });

    expect(sidePathGate(s)).toBeNull();
  });

  it('still takes a side gate when the street has one too', () => {
    const s = site({
      streetEdgeVertexId: 'v3',
      gates: [
        gate({ id: 'g2', edgeVertexId: 'v3', offsetAlongEdge: 10 }),
        gate({ id: 'g3', edgeVertexId: 'v2', offsetAlongEdge: 6 }),
      ],
    });

    expect(sidePathGate(s)?.gate.id).toBe('g3');
  });

  it('will walk through a driveway when that is the only way in', () => {
    const drive = gate({ edgeVertexId: 'v2', offsetAlongEdge: 6, width: 3, kind: 'vehicle' });
    expect(sidePathGate(site({ gates: [drive] }))?.gate.kind).toBe('vehicle');
  });

  it('treats an open gap as walk-through, ahead of a driveway', () => {
    const drive = gate({
      id: 'g2',
      edgeVertexId: 'v4',
      offsetAlongEdge: 8,
      width: 3,
      kind: 'vehicle',
    });
    const gap = gate({ id: 'g3', edgeVertexId: 'v2', offsetAlongEdge: 6, width: 3, kind: 'open' });

    expect(sidePathGate(site({ gates: [drive, gap] }))?.gate.id).toBe('g3');
  });

  it('has no answer with no gates, or when none of them resolve', () => {
    expect(sidePathGate(site())).toBeNull();
    expect(sidePathGate(site({ gates: [gate({ edgeVertexId: 'v9' })] }))).toBeNull();
  });
});

describe('gate kinds', () => {
  it('reads a stored gate that predates kinds as the pedestrian gate it was', () => {
    const parsed = SiteSectionSchema.parse({
      vertices: [],
      closed: false,
      house: null,
      gates: [{ id: 'g1', edgeVertexId: 'v2', offsetAlongEdge: 6 }],
    });

    expect(parsed.gates[0]).toEqual({
      id: 'g1',
      edgeVertexId: 'v2',
      offsetAlongEdge: 6,
      width: 0.9,
      kind: 'pedestrian',
    });
  });
});

describe('firstFreeOffsetOnEdge', () => {
  it('offers the centre of an empty side', () => {
    expect(firstFreeOffsetOnEdge(site(), 'v2', gate())).toBe(8);
  });

  it('offers the first gap when the centre is taken', () => {
    const s = site({ gates: [gate({ offsetAlongEdge: 8 })] });
    expect(firstFreeOffsetOnEdge(s, 'v2', gate({ id: 'g2' }))).toBeCloseTo(0.45);
  });

  it('is null for a side too short to hold it', () => {
    expect(firstFreeOffsetOnEdge(site(), 'v2', gate({ width: 40 }))).toBeNull();
  });
});

/**
 * The same plot with a corner v9 put into the right-hand side, v2 (20,0) → v3 (20,16), four
 * metres down from v2. The side is straight, so v9 is a redundant corner.
 */
function withCorner(at: Point, overrides: Partial<SiteSection> = {}): SiteSection {
  return site({
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 20, y: 0 },
      { id: 'v9', ...at },
      { id: 'v3', x: 20, y: 16 },
      { id: 'v4', x: 0, y: 16 },
    ],
    ...overrides,
  });
}

describe('gatesAfterSplit', () => {
  const cut = { x: 20, y: 4 };

  it('leaves a gate before the cut where it was', () => {
    const after = withCorner(cut, { gates: [gate({ offsetAlongEdge: 2 })] });
    const [moved] = gatesAfterSplit(after, 'v2', 'v9', 4);

    expect(moved).toMatchObject({ edgeVertexId: 'v2', offsetAlongEdge: 2 });
  });

  it('re-homes a gate beyond the cut onto the new edge, measured from the new corner', () => {
    const after = withCorner(cut, { gates: [gate({ offsetAlongEdge: 10 })] });
    const [moved] = gatesAfterSplit(after, 'v2', 'v9', 4);

    expect(moved).toMatchObject({ edgeVertexId: 'v9', offsetAlongEdge: 6 });
    // Same place on the plan as before the corner went in.
    expect(gateCentre(after, moved!)).toEqual({ x: 20, y: 10 });
  });

  it('nudges a gate the cut ran through whole onto one half', () => {
    // Centre 4.2 m along, so it goes to the second half at 0.2 m — and is clamped to 0.45 so it
    // sits flush against the new corner rather than straddling it.
    const after = withCorner(cut, { gates: [gate({ offsetAlongEdge: 4.2 })] });
    const [moved] = gatesAfterSplit(after, 'v2', 'v9', 4);

    expect(moved).toMatchObject({ edgeVertexId: 'v9', offsetAlongEdge: 0.45 });
    expect(fitsOnEdge(after, moved!)).toBe(true);
  });

  it('leaves gates on other sides alone', () => {
    const after = withCorner(cut, { gates: [gate({ edgeVertexId: 'v4', offsetAlongEdge: 3 })] });
    expect(gatesAfterSplit(after, 'v2', 'v9', 4)).toEqual(after.gates);
  });
});

describe('accessAfterDelete', () => {
  it('carries a gate across when the deleted corner was on a straight side', () => {
    // On v9's edge, 8 m along: at (20, 12). The merged side v2 → v3 passes straight through it.
    const before = withCorner(
      { x: 20, y: 4 },
      {
        gates: [gate({ edgeVertexId: 'v9', offsetAlongEdge: 8 })],
        streetEdgeVertexId: 'v9',
      },
    );
    const after = site({ gates: before.gates, streetEdgeVertexId: 'v9' });

    const result = accessAfterDelete(before, after, 'v9');

    expect(result.gates).toHaveLength(1);
    expect(result.gates[0]).toMatchObject({ edgeVertexId: 'v2', offsetAlongEdge: 12 });
    expect(gateCentre(after, result.gates[0]!)).toEqual({ x: 20, y: 12 });
    expect(result.streetEdgeVertexId).toBe('v2');
  });

  it('drops a gate that was on a real bend, and forgets a street that was', () => {
    // The corner stuck 4 m out into next door: the gate's old centre is nowhere near the line.
    const before = withCorner(
      { x: 24, y: 8 },
      {
        gates: [gate({ edgeVertexId: 'v9', offsetAlongEdge: 3 })],
        streetEdgeVertexId: 'v9',
      },
    );
    const after = site({ gates: before.gates, streetEdgeVertexId: 'v9' });

    const result = accessAfterDelete(before, after, 'v9');

    expect(result.gates).toHaveLength(0);
    expect(result.streetEdgeVertexId).toBeNull();
  });

  it('will not carry a gate through one already on the merged side', () => {
    const before = withCorner(
      { x: 20, y: 4 },
      {
        gates: [
          gate({ id: 'g1', edgeVertexId: 'v2', offsetAlongEdge: 2 }),
          gate({ id: 'g2', edgeVertexId: 'v9', offsetAlongEdge: 8 }),
          // 0.3 m along v9's edge is (20, 4.3): on the merged side it would land at 4.3.
          gate({ id: 'g3', edgeVertexId: 'v9', offsetAlongEdge: 0.3 }),
        ],
      },
    );
    const after = site({
      gates: [
        gate({ id: 'g1', edgeVertexId: 'v2', offsetAlongEdge: 2 }),
        gate({ id: 'g4', edgeVertexId: 'v2', offsetAlongEdge: 4.3 }),
      ],
    });

    const result = accessAfterDelete(before, { ...after, gates: [...after.gates] }, 'v9');
    const ids = result.gates.map((entry) => entry.id).sort();

    // g1 and g4 were already there, g2 is carried, g3 would go through g4 and is dropped.
    expect(ids).toEqual(['g1', 'g2', 'g4']);
  });

  it('leaves gates on other sides and an unrelated street edge alone', () => {
    const before = withCorner(
      { x: 24, y: 8 },
      {
        gates: [gate({ edgeVertexId: 'v4', offsetAlongEdge: 3 })],
        streetEdgeVertexId: 'v3',
      },
    );
    const after = site({ gates: before.gates, streetEdgeVertexId: 'v3' });

    expect(accessAfterDelete(before, after, 'v9')).toEqual({
      gates: before.gates,
      streetEdgeVertexId: 'v3',
    });
  });
});

/** Kept for a reader checking the frame: +y is down the screen, so "in front" of the house is +y. */
export type { Point };
