import { describe, expect, it } from 'vitest';
import {
  emptyPlanDocument,
  PlanDocumentSchema,
  PLAN_DOCUMENT_VERSION,
  readPlanDocument,
  type PlanDocument,
} from './document.js';

/**
 * A wizard filled in end to end: a closed boundary, a rotated house, one feature of every
 * geometry kind, a complete brief, a generated concept and an edited layout.
 *
 * This is the proof that the whole wizard is expressible as one document — the precondition for
 * persisting it at all. If a screen grows state that cannot round-trip through here, this test
 * is where it should fail.
 */
function fullyPopulated(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: PLAN_DOCUMENT_VERSION,
    unit: 'm',
    site: {
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 20, y: 0 },
        { id: 'v3', x: 20, y: 16 },
        { id: 'v4', x: 0, y: 16 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        walls: [
          { id: 'w0', kind: 'external' },
          { id: 'w1', kind: 'party' },
          { id: 'w2', kind: 'external' },
          { id: 'w3', kind: 'garage' },
        ],
        openings: [
          {
            id: 'o1',
            wallId: 'w2',
            offsetAlongEdge: 4,
            width: 2.4,
            type: 'patio-door',
            sillHeight: 0,
            floorLevel: 0,
            swing: 'none',
          },
          {
            id: 'o2',
            wallId: 'w2',
            offsetAlongEdge: 1,
            width: 1.2,
            type: 'window',
            sillHeight: 0.9,
            floorLevel: 0,
            swing: 'none',
          },
        ],
        centre: { x: 10, y: 4 },
        rotation: 15,
      },
      selectedZoneIds: ['front', 'back'],
      orientation: 30,
    },
    features: {
      features: [
        {
          id: 'f1',
          kind: 'tree',
          name: 'Apple tree',
          geometry: { kind: 'point', at: { x: 4, y: 12 }, radius: 1.5 },
          status: 'keep',
          replaceWith: null,
        },
        {
          id: 'f2',
          kind: 'shed',
          name: 'Side shed',
          geometry: { kind: 'rect', centre: { x: 17, y: 13 }, width: 2.5, depth: 2, rotation: 0 },
          status: 'remove',
          replaceWith: null,
        },
        {
          id: 'f3',
          kind: 'patio',
          name: 'Rear patio',
          geometry: {
            kind: 'polygon',
            points: [
              { x: 6, y: 9 },
              { x: 13, y: 9 },
              { x: 13, y: 12 },
              { x: 6, y: 12 },
            ],
            cornerRadius: 0.5,
          },
          status: 'replace',
          replaceWith: 'Deck',
        },
        {
          id: 'f4',
          kind: 'path',
          name: 'Side path',
          geometry: {
            kind: 'polyline',
            points: [
              { x: 1, y: 1 },
              { x: 1, y: 15 },
            ],
            width: 1,
          },
          status: 'keep',
          replaceWith: null,
        },
      ],
      skipped: false,
    },
    brief: {
      purpose: 'Somewhere to eat outside and let the children run around.',
      desiredFeatures: ['seating', 'play', 'other'],
      featuresOther: 'Washing line',
      budget: 'medium',
      maintenance: 'low',
      style: 'other',
      styleOther: 'Coastal',
    },
    concepts: {
      concepts: [
        {
          id: 'c2-0',
          name: 'Balanced',
          recommended: true,
          summary: 'A dining terrace off the house with lawn beyond.',
          style: 'Modern / Natural',
          budget: 'medium',
          maintenance: 'low',
          requestedFeaturesIncluded: [
            { feature: 'seating', label: 'Seating / dining area', included: true },
            { feature: 'play', label: 'Play area', included: false },
          ],
          elements: [
            {
              id: 'c2-0-e1',
              category: 'lawn',
              role: 'fill',
              fillKind: 'base',
              shape: {
                kind: 'polygon',
                points: [
                  { x: 0, y: 8 },
                  { x: 20, y: 8 },
                  { x: 20, y: 16 },
                  { x: 0, y: 16 },
                ],
                cornerRadius: 0,
              },
              zone: 'front',
            },
            {
              id: 'c2-0-e2',
              category: 'paved-area',
              role: 'feature',
              name: 'Dining terrace',
              shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 5, depth: 4, rotation: 0 },
              zone: 'front',
              material: 'stone-pavers',
              elevation: 0,
            },
          ],
        },
      ],
      selectedId: 'c2-0',
      chosenConceptId: 'c2-0',
      seed: 2,
    },
    layout: {
      elements: [
        {
          id: 'e-1',
          category: 'paved-area',
          role: 'feature',
          name: 'Dining terrace',
          shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 6, depth: 4, rotation: 0 },
          zone: 'front',
          material: 'porcelain',
          hidden: false,
        },
      ],
      seededFrom: 'c2-0',
      pristine: [
        {
          id: 'e-1',
          category: 'paved-area',
          role: 'feature',
          name: 'Dining terrace',
          shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 5, depth: 4, rotation: 0 },
          zone: 'front',
          material: 'stone-pavers',
        },
      ],
    },
  });
}

describe('PlanDocumentSchema', () => {
  it('round-trips a fully populated wizard through JSON', () => {
    const document = fullyPopulated();

    expect(PlanDocumentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('defaults every section independently, so a bare object is a valid empty plan', () => {
    const document = emptyPlanDocument();

    expect(document.version).toBe(PLAN_DOCUMENT_VERSION);
    expect(document.unit).toBe('m');
    expect(document.site).toEqual({
      vertices: [],
      closed: false,
      house: null,
      selectedZoneIds: [],
      // North is up until somebody says otherwise, which is where the compass has always pointed.
      orientation: 0,
      // Null, not a plausible-looking default. Orientation can sensibly default because "north
      // is up" is a real statement about the drawing; a latitude cannot, so this stays absent
      // and every solar claim in the app is gated on it being filled in.
      location: null,
      // About 21 June at 15:00 — the longest day, at the hour a garden is judged.
      sun: { dayOfYear: 172, minutes: 900 },
    });
    expect(document.features).toEqual({ features: [], skipped: false });
    expect(document.brief.budget).toBeNull();
    expect(document.concepts.seed).toBe(1);
    expect(document.layout.pristine).toBeNull();
  });

  it('accepts a document that is missing a section it has never used', () => {
    const result = PlanDocumentSchema.safeParse({
      version: 1,
      site: { vertices: [], closed: false, house: null, selectedZoneIds: [] },
    });

    expect(result.success).toBe(true);
  });

  it('rejects geometry that is not one of the four kinds', () => {
    const result = PlanDocumentSchema.safeParse({
      version: 1,
      features: {
        features: [
          {
            id: 'f1',
            kind: 'tree',
            name: 'Tree',
            geometry: { kind: 'circle', centre: { x: 1, y: 1 }, radius: 1 },
            status: 'keep',
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown feature status', () => {
    const result = PlanDocumentSchema.safeParse({
      version: 1,
      features: {
        features: [
          {
            id: 'f1',
            kind: 'tree',
            name: 'Tree',
            geometry: { kind: 'point', at: { x: 1, y: 1 }, radius: 1 },
            status: 'demolish',
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('readPlanDocument', () => {
  it('upgrades a document stored before versions existed', () => {
    const document = readPlanDocument({ site: { vertices: [], closed: false } });

    expect(document.version).toBe(PLAN_DOCUMENT_VERSION);
    expect(document.brief.budget).toBeNull();
  });

  it('stamps the current version on a document that claims an older one', () => {
    expect(readPlanDocument({ version: 0 }).version).toBe(PLAN_DOCUMENT_VERSION);
  });

  it('leaves a current document alone', () => {
    const document = fullyPopulated();

    expect(readPlanDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
});

/**
 * The first migration that does real work, and the reason the mechanism was built ahead of needing
 * it. `outline` changes element type from `Point` to `HouseVertex`, so unlike every change before
 * it a stored row genuinely does not parse without help.
 */
describe('the 1 → 2 migration', () => {
  /** A house exactly as it was stored before vertex ids existed. */
  function v1(): unknown {
    return {
      version: 1,
      site: {
        vertices: [{ id: 'v1', x: 0, y: 0 }],
        closed: true,
        house: {
          outline: [
            { x: -4, y: -3 },
            { x: 4, y: -3 },
            { x: 4, y: 3 },
            { x: -4, y: 3 },
          ],
          centre: { x: 10, y: 4 },
          rotation: 15,
        },
        selectedZoneIds: ['back'],
      },
    };
  }

  it('gives every house corner an id', () => {
    const house = readPlanDocument(v1()).site.house!;

    expect(house.outline.map((vertex) => vertex.id)).toEqual(['h0', 'h1', 'h2', 'h3']);
  });

  it('gives every wall an id and calls it external until told otherwise', () => {
    const house = readPlanDocument(v1()).site.house!;

    expect(house.walls).toEqual([
      { id: 'w0', kind: 'external' },
      { id: 'w1', kind: 'external' },
      { id: 'w2', kind: 'external' },
      { id: 'w3', kind: 'external' },
    ]);
  });

  it('moves no geometry at all', () => {
    const before = (v1() as { site: { house: { outline: { x: number; y: number }[] } } }).site
      .house;
    const after = readPlanDocument(v1()).site.house!;

    expect(after.outline.map(({ x, y }) => ({ x, y }))).toEqual(before.outline);
    expect(after.centre).toEqual(before.centre);
    expect(after.rotation).toBe(before.rotation);
  });

  it('defaults the orientation rather than inventing one', () => {
    expect(readPlanDocument(v1()).site.orientation).toBe(0);
  });

  /*
   * The migration stance for openings is empty-and-degrade: a plan written before doors existed
   * has none, every constraint that depends on one is skipped, and it generates exactly as it did
   * before. Inferring a patio door here would have the generator design confidently around a guess
   * the user never made and cannot see.
   */
  it('leaves a migrated house with no openings rather than guessing at one', () => {
    expect(readPlanDocument(v1()).site.house!.openings).toEqual([]);
  });

  it('carries the rest of the plan through untouched', () => {
    const document = readPlanDocument(v1());

    expect(document.site.vertices).toEqual([{ id: 'v1', x: 0, y: 0 }]);
    expect(document.site.selectedZoneIds).toEqual(['back']);
    expect(document.version).toBe(PLAN_DOCUMENT_VERSION);
  });

  it('has nothing to do for a plan whose house was never placed', () => {
    const document = readPlanDocument({ version: 1, site: { vertices: [], house: null } });

    expect(document.site.house).toBeNull();
  });

  /*
   * A document stored before versions existed reads as 0 and walks the whole chain, so it has to
   * survive the house migration too rather than only the no-op before it.
   */
  it('runs for an unversioned document as well', () => {
    const unversioned = { ...(v1() as object), version: undefined };
    const house = readPlanDocument(unversioned).site.house!;

    expect(house.outline.map((vertex) => vertex.id)).toEqual(['h0', 'h1', 'h2', 'h3']);
  });

  it('is idempotent, so a document that already has ids is not renumbered', () => {
    const once = readPlanDocument(v1());
    // Re-reading a stored v2 must not touch it; ids only ever change when a corner is added.
    const twice = readPlanDocument(JSON.parse(JSON.stringify(once)));

    expect(twice).toEqual(once);
  });
});
