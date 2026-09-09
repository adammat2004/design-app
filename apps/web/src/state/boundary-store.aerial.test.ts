import { beforeEach, describe, expect, it } from 'vitest';
import { SiteSectionSchema } from '@garden-studio/schema';
import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { localFrame } from '@/lib/geo/local-frame';
import { computeZones } from '@/lib/zones';
import {
  hydrateBoundaryStore,
  mappingMethodOf,
  resetBoundaryStoreForTests,
  useBoundaryStore,
} from './boundary-store';

const store = () => useBoundaryStore.getState();
const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };
const ELSEWHERE = { latitude: 51.5, longitude: -0.12 };

beforeEach(() => {
  resetBoundaryStoreForTests();
});

describe('choosing a mapping method', () => {
  it('turns the grid and right-angle snaps off for tracing and back on for measuring', () => {
    store().setMappingMethod('aerial');
    expect(store().mappingMethod).toBe('aerial');
    expect(store().snapEnabled).toBe(false);
    expect(store().rightAngleSnap).toBe(false);

    store().setMappingMethod('manual');
    expect(store().snapEnabled).toBe(true);
    expect(store().rightAngleSnap).toBe(true);
  });

  it('centres the imagery without storing anything', () => {
    store().locateImagery(DUBLIN, 140);
    expect(store().imageryAnchor).toEqual(DUBLIN);
    expect(store().imageryViewSpan).toBe(140);
    expect(store().present.georeference).toBeNull();
    expect(store().present.location).toBeNull();
  });
});

describe('georeferenceAt', () => {
  it('pins the frame, applies the sun location, puts north up and takes one undo entry', () => {
    store().setOrientation(35);
    const before = store().past.length;

    store().georeferenceAt(DUBLIN);

    expect(store().present.georeference).toEqual(DUBLIN);
    expect(store().present.location).toEqual(DUBLIN);
    expect(store().present.orientation).toBe(0);
    expect(store().mappingMethod).toBe('aerial');
    expect(store().snapEnabled).toBe(false);
    expect(store().past.length).toBe(before + 1);

    store().undo();
    expect(store().present.georeference).toBeNull();
    expect(store().present.orientation).toBe(35);
  });

  it('does not overwrite a sun location the user set by hand', () => {
    store().setLocation(ELSEWHERE);
    store().georeferenceAt(DUBLIN);
    expect(store().present.location).toEqual(ELSEWHERE);
    expect(store().present.georeference).toEqual(DUBLIN);
  });

  it('refuses a reading that is not a place on Earth', () => {
    store().georeferenceAt({ latitude: 91, longitude: 0 });
    expect(store().present.georeference).toBeNull();
    expect(store().past).toHaveLength(0);
  });

  it('clearing the sun location leaves the georeference alone, and removing location data clears both', () => {
    store().georeferenceAt(DUBLIN);
    store().setLocation(null);
    expect(store().present.location).toBeNull();
    expect(store().present.georeference).toEqual(DUBLIN);

    store().clearGeoreference();
    expect(store().present.georeference).toBeNull();
    expect(store().present.location).toBeNull();
  });
});

describe('a traced plan', () => {
  it('parses as an ordinary SiteSection and yields the same zones wherever its origin is', () => {
    store().georeferenceAt(DUBLIN);
    // The first corner is the origin; the rest are wherever the fence was, negatives included.
    for (const point of [
      { x: 0, y: 0 },
      { x: 18, y: -1 },
      { x: 17, y: -17 },
      { x: -1, y: -16 },
    ]) {
      store().addVertexAt(point);
    }
    store().closeShape();
    store().placeHouseRectangle({ x: 8.5, y: -4 }, 8, 6);

    const site = SiteSectionSchema.parse(store().present);
    expect(site.georeference).toEqual(DUBLIN);
    expect(site.closed).toBe(true);

    // Translation changes nothing downstream: nothing assumes the plot sits at (0, 0).
    const shifted = {
      ...site,
      vertices: site.vertices.map((v) => ({ ...v, x: v.x + 40, y: v.y + 25 })),
      house: { ...site.house!, centre: { x: site.house!.centre.x + 40, y: site.house!.centre.y + 25 } },
    };
    const zonesHere = computeZones(draftPolygon(site), site.house);
    const zonesThere = computeZones(draftPolygon(shifted), shifted.house);
    expect(zonesThere.map((z) => z.id)).toEqual(zonesHere.map((z) => z.id));
    zonesThere.forEach((zone, i) => expect(zone.area).toBeCloseTo(zonesHere[i]!.area, 9));
    expect(polygonArea(draftPolygon(shifted))).toBeCloseTo(polygonArea(draftPolygon(site)), 9);
  });

  it('is traced with the grid snap off, so a corner lands exactly where it was clicked', () => {
    store().georeferenceAt(DUBLIN);
    store().addVertexAt({ x: 0, y: 0 });
    store().addVertexAt({ x: 12.37, y: 0.41 });
    expect(store().present.vertices[1]).toMatchObject({ x: 12.37, y: 0.41 });
  });

  it('round-trips its origin: the stored point is corner A', () => {
    const frame = localFrame(DUBLIN);
    store().georeferenceAt(DUBLIN);
    store().addVertexAt({ x: 0, y: 0 });
    const cornerA = frame.toLatLng(store().present.vertices[0]!);
    expect(cornerA.latitude).toBeCloseTo(DUBLIN.latitude, 9);
    expect(cornerA.longitude).toBeCloseTo(DUBLIN.longitude, 9);
  });
});

describe('checking traced sides', () => {
  function tracePlot() {
    store().georeferenceAt(DUBLIN);
    for (const point of [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ]) {
      store().addVertexAt(point);
    }
    store().closeShape();
  }

  it('marks a side checked when it is typed or ticked, and once only', () => {
    tracePlot();
    const [a, b] = store().present.vertices;

    store().setEdgeLength(0, 20.4);
    expect(store().checkedEdgeIds).toEqual([a!.id]);

    store().confirmEdge(b!.id);
    store().confirmEdge(b!.id);
    expect(store().checkedEdgeIds).toEqual([a!.id, b!.id]);
  });

  it('typing the length a side already has still counts as checking it', () => {
    tracePlot();
    const before = store().past.length;
    store().setEdgeLength(1, 16);
    expect(store().checkedEdgeIds).toEqual([store().present.vertices[1]!.id]);
    // But it is not an edit, so it is not on the undo stack.
    expect(store().past.length).toBe(before);
  });

  it('forgets the checks on reset but keeps the imagery where it was', () => {
    tracePlot();
    store().confirmEdge(store().present.vertices[0]!.id);
    store().resetDraft();
    expect(store().checkedEdgeIds).toEqual([]);
    expect(store().present.georeference).toBeNull();
    expect(store().imageryAnchor).toEqual(DUBLIN);
  });
});

describe('loading a stored plan', () => {
  it('derives the mapping method from the document rather than remembering it', () => {
    const empty = SiteSectionSchema.parse({});
    expect(mappingMethodOf(empty)).toBe('undecided');

    const measured = SiteSectionSchema.parse({
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 10, y: 0 },
        { id: 'v3', x: 10, y: 8 },
      ],
      closed: true,
    });
    expect(mappingMethodOf(measured)).toBe('manual');

    const traced = SiteSectionSchema.parse({ ...measured, georeference: DUBLIN });
    expect(mappingMethodOf(traced)).toBe('aerial');
  });

  it('reopens a traced plan over the photograph with the snaps off', () => {
    const traced = SiteSectionSchema.parse({
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 10, y: 0 },
        { id: 'v3', x: 10, y: 8 },
      ],
      closed: true,
      georeference: DUBLIN,
    });
    hydrateBoundaryStore(traced, 'm', 'Traced', Date.now());

    expect(store().mappingMethod).toBe('aerial');
    expect(store().snapEnabled).toBe(false);
    expect(store().present.georeference).toEqual(DUBLIN);
    expect(store().checkedEdgeIds).toEqual([]);
  });

  it('reopens a measured plan exactly as before', () => {
    const measured = SiteSectionSchema.parse({
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 10, y: 0 },
        { id: 'v3', x: 10, y: 8 },
      ],
      closed: true,
    });
    hydrateBoundaryStore(measured, 'm', 'Measured', Date.now());

    expect(store().mappingMethod).toBe('manual');
    expect(store().snapEnabled).toBe(true);
    expect(store().rightAngleSnap).toBe(true);
    expect(store().present.georeference).toBeNull();
  });
});
