import { describe, expect, it } from 'vitest';
import type { Point } from '../geometry/primitives.js';
import { MIN_SCOPE_AREA, resolveDesignScope, scopeRing } from './scope.js';
import { rectangleHouse, SiteSectionSchema, type SiteSection } from './site.js';
import { computeZones } from './zones.js';

/** A 20 × 16 m plot with a house near the top, the same fixture `gates.test.ts` uses. */
function site(overrides: Partial<SiteSection> = {}): SiteSection {
  return SiteSectionSchema.parse({
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 20, y: 0 },
      { id: 'v3', x: 20, y: 16 },
      { id: 'v4', x: 0, y: 16 },
    ],
    closed: true,
    house: rectangleHouse({ x: 10, y: 4 }, 8, 6),
    ...overrides,
  });
}

function rect(x: number, y: number, width: number, depth: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

describe('scopeRing', () => {
  it('returns the ring the user drew', () => {
    const polygon = rect(4, 8, 10, 6);

    expect(scopeRing(site({ scopePolygon: polygon }))).toEqual(polygon);
  });

  it('is null when nothing was drawn, which is every stored plan', () => {
    expect(scopeRing(site())).toBeNull();
  });

  /*
   * The case the whole module exists for. A bow tie has a perfectly ordinary vertex list and a
   * shoelace area that is quietly wrong, so nothing downstream would report it — and PostGIS
   * would happily intersect against it and paint somewhere nobody asked for.
   */
  it('refuses a ring that crosses itself', () => {
    const bowTie = [
      { x: 4, y: 8 },
      { x: 14, y: 8 },
      { x: 4, y: 14 },
      { x: 14, y: 14 },
    ];

    expect(scopeRing(site({ scopePolygon: bowTie }))).toBeNull();
  });

  it('refuses a ring that leaves the property rather than trimming it', () => {
    // Straddles the right fence: ST_Intersection would absorb the overhang without a word.
    expect(scopeRing(site({ scopePolygon: rect(16, 8, 10, 4) }))).toBeNull();
  });

  it('refuses a sliver', () => {
    const sliver = rect(4, 8, 4, 0.2);

    expect(sliver).toSatisfy(() => 4 * 0.2 < MIN_SCOPE_AREA);
    expect(scopeRing(site({ scopePolygon: sliver }))).toBeNull();
  });

  it('accepts a ring flush against the fence, as ST_Contains does', () => {
    expect(scopeRing(site({ scopePolygon: rect(0, 8, 20, 8) }))).not.toBeNull();
  });
});

describe('resolveDesignScope', () => {
  const zones = () => computeZones(site().vertices, site().house);

  it('calls no ticks the entire garden, which is how the generator has always read it', () => {
    const scope = resolveDesignScope(site({ selectedZoneIds: [] }), zones());

    expect(scope.type).toBe('entire_garden');
    expect(scope.zones.sort()).toEqual(
      zones()
        .map((zone) => zone.id)
        .sort(),
    );
  });

  it('calls every zone ticked the entire garden too', () => {
    const all = zones().map((zone) => zone.id);

    expect(resolveDesignScope(site({ selectedZoneIds: all }), zones()).type).toBe('entire_garden');
  });

  it('reports a subset as zones', () => {
    const scope = resolveDesignScope(site({ selectedZoneIds: ['back'] }), zones());

    expect(scope.type).toBe('zones');
    expect(scope.zones).toEqual(['back']);
  });

  /*
   * The reconciliation the screens already do: a tick survives in the document so the choice comes
   * back if the zone does, but a zone the house has dissolved is never reported as selected.
   */
  it('drops a tick for a zone that no longer exists', () => {
    const scope = resolveDesignScope(site({ selectedZoneIds: ['back', 'left'] }), [
      zones().find((zone) => zone.id === 'back')!,
    ]);

    expect(scope.zones).toEqual(['back']);
  });

  it('reports a drawn area as custom, and still says which zones it spans', () => {
    const polygon = rect(4, 8, 10, 6);
    const scope = resolveDesignScope(
      site({ selectedZoneIds: ['back'], scopePolygon: polygon }),
      zones(),
    );

    expect(scope).toEqual({ type: 'custom', zones: ['back'], polygon });
  });

  // An unusable ring must not silently promote itself into "design the whole plot".
  it('falls back to the zone reading when the drawn area is not usable', () => {
    const scope = resolveDesignScope(
      site({ selectedZoneIds: ['back'], scopePolygon: rect(16, 8, 10, 4) }),
      zones(),
    );

    expect(scope).toEqual({ type: 'zones', zones: ['back'] });
  });
});
