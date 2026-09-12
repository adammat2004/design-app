import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  computeZones,
  effectiveZoneIds,
  gardenDirection,
  measureComposition,
  PlanDocumentSchema,
  polygonCentroid,
  readPlanDocument,
  rectangleHouse,
  rectanglePlotOutline,
  suggestedAccess,
  zoneAt,
  type GardenBrief,
  type PlanDocument,
} from '@garden-studio/schema';
import { connectTestDatabase } from '../../test/db.js';
import { ConceptsService } from './concepts.service.js';
import { PlacementService } from './placement.service.js';
import { FillService } from './fill.service.js';
import { GeometryValidationService } from '../geometry-validation.service.js';
import { compositionRules, describeComposition } from './composition-rules.js';
import { backFrame, gardenRoom, localBox } from './layout/frame.js';

const connection = await connectTestDatabase();
afterAll(async () => {
  await connection?.close();
});

const extraCases: Record<
  string,
  {
    width: number;
    depth: number;
    houseWidth: number;
    houseDepth: number;
    houseY?: number;
    style: GardenBrief['style'];
    budget?: GardenBrief['budget'];
    features?: GardenBrief['desiredFeatures'];
  }
> = {
  small: { width: 9, depth: 14, houseWidth: 7, houseDepth: 4, style: 'modern' },
  wide: {
    width: 23,
    depth: 10,
    houseWidth: 12,
    houseDepth: 4,
    houseY: 5,
    style: 'modern',
    features: ['seating', 'pergola'],
  },
  narrow: {
    width: 7,
    depth: 30,
    houseWidth: 5,
    houseDepth: 5,
    style: 'cottage',
    features: ['seating', 'storage'],
  },
  formal: {
    width: 14,
    depth: 22,
    houseWidth: 10,
    houseDepth: 5,
    style: 'formal',
    features: ['seating', 'water', 'storage'],
  },
  naturalistic: {
    width: 18,
    depth: 24,
    houseWidth: 10,
    houseDepth: 5,
    style: null,
    features: ['seating', 'water'],
  },
  entertaining: {
    width: 20,
    depth: 26,
    houseWidth: 12,
    houseDepth: 6,
    style: 'modern',
    budget: 'premium',
    features: ['seating', 'outdoorKitchen', 'storage'],
  },
};

function extraDocument(name: string) {
  const item = extraCases[name]!;
  return PlanDocumentSchema.parse({
    version: 2,
    unit: 'm',
    site: suggestedAccess(
      PlanDocumentSchema.shape.site.parse({
        vertices: rectanglePlotOutline({ width: item.width, depth: item.depth }).map((p, i) => ({
          ...p,
          id: `v${i}`,
        })),
        closed: true,
        house: rectangleHouse(
          { x: item.width / 2, y: item.houseY ?? item.depth - item.houseDepth / 2 },
          item.houseWidth,
          item.houseDepth,
        ),
        selectedZoneIds: ['back', 'left', 'right'],
        location: { latitude: 53.4, longitude: -2.98 },
      }),
    ),
    brief: {
      purpose: 'Representative composition and circulation fixture.',
      desiredFeatures: item.features ?? ['seating', 'storage'],
      featuresOther: '',
      budget: item.budget ?? 'medium',
      maintenance: 'medium',
      style: item.style,
      styleOther: '',
    },
  });
}

/**
 * How deep the back room is, so a shallow garden's terrace is judged against the room rather than
 * against the floor it could never reach. Mirrors what `build` computes for the grammar.
 */
function backRoomOf(document: PlanDocument) {
  const house = document.site.house;
  const garden = gardenDirection(document.site);
  if (!house || !garden) return null;
  const frame = backFrame(house, garden);
  if (!frame) return null;
  const boundary = document.site.vertices.map(({ x, y }) => ({ x, y }));
  const zones = computeZones(boundary, house);
  const ticked = effectiveZoneIds(document.site.selectedZoneIds, zones);
  const scope = ticked.length > 0 ? ticked : zones.map((zone) => zone.id);
  const room = gardenRoom(boundary, house, frame, scope);
  return room.length >= 3 ? { frame, room, zones } : null;
}

function roomDepthOf(document: PlanDocument): number | null {
  const back = backRoomOf(document);
  return back ? localBox(back.room, back.frame).uMax : null;
}

/** The zone the grammar designed in: where the terrace, the lawn and the beds are. */
function mainZoneId(document: PlanDocument) {
  const back = backRoomOf(document);
  return back ? (zoneAt(polygonCentroid(back.room), back.zones)?.id ?? null) : null;
}

/**
 * Each case generates three whole concepts against real PostGIS — a dozen or so queries apiece,
 * and several seconds for the larger plots. Vitest's 5 s default is not a budget these were ever
 * written to: the suburban fixture alone runs to about 4.5 s on a warm database and longer on a
 * cold one, so under a loaded suite it was timing out on machine speed rather than on anything
 * about the generator. Stated here rather than raised globally, which would take the timeout off
 * the fast unit suites that genuinely should not take seconds.
 */
const FIXTURE_TIMEOUT_MS = 30_000;

// The capture flag is an explicit offline asset-maintenance command. No saved projects are written.
describe.skipIf(!connection)('reference garden fixtures', () => {
  for (const name of [
    'suburban',
    'l-shape',
    'courtyard',
    'reference',
    ...Object.keys(extraCases),
  ]) {
    it(
      `generates a valid ${name} design`,
      async () => {
        const fixtureDir = resolve('../web/scripts/fixtures');
        const document = extraCases[name]
          ? extraDocument(name)
          : name === 'reference'
            ? PlanDocumentSchema.parse({
                version: 2,
                unit: 'm',
                site: suggestedAccess(
                  PlanDocumentSchema.shape.site.parse({
                    vertices: [
                      { id: 'v0', x: 0, y: 0 },
                      { id: 'v1', x: 12.5, y: 0 },
                      { id: 'v2', x: 12.5, y: 19 },
                      { id: 'v3', x: 0, y: 19 },
                    ],
                    closed: true,
                    house: rectangleHouse({ x: 6.25, y: 16.5 }, 10, 5),
                    selectedZoneIds: ['back', 'left', 'right'],
                    location: { latitude: 53.4, longitude: -2.98 },
                  }),
                ),
                brief: {
                  purpose: 'A generous lawn, dining terrace, pergola and layered planting.',
                  desiredFeatures: ['seating', 'pergola', 'firePit', 'storage'],
                  featuresOther: '',
                  budget: 'medium',
                  maintenance: 'medium',
                  style: 'cottage',
                  styleOther: '',
                },
              })
            : readPlanDocument(
                JSON.parse(readFileSync(resolve(fixtureDir, `${name}.plan.json`), 'utf8')),
              );
        const service = new ConceptsService(
          new PlacementService(connection!.db),
          new FillService(connection!.db),
        );
        const concepts = await service.generate(document, 11);
        const recommended = concepts.find((concept) => concept.recommended)!;

        /*
         * Every concept: legal geometry, and a composition inside the bands the traced target set.
         * The rules are report-only under `COMPOSITION_REPORT=1`, which prints the table used to
         * derive and re-check the bands; otherwise they are assertions.
         */
        const zones = computeZones(
          document.site.vertices.map(({ x, y }) => ({ x, y })),
          document.site.house,
        );
        const ticked = effectiveZoneIds(document.site.selectedZoneIds, zones);
        const inScope = zones.filter((zone) =>
          (ticked.length > 0 ? ticked : zones.map((z) => z.id)).includes(zone.id),
        );
        const roomDepth = roomDepthOf(document);
        /*
         * The garden proper — the zone the grammar composed — is what the bands are asserted on.
         * The whole plot is reported beside it: a side return or a front garden still mostly base
         * ground is a real gap, but it is the next pass's gap (an arrival that is more than a path,
         * a room per wide side), and asserting it here would pin today's number rather than the
         * target's.
         */
        const mainZone = inScope.find((zone) => zone.id === mainZoneId(document)) ?? null;

        for (const concept of concepts) {
          /*
           * Lawn permission is the *concept's*, not the brief's: an archetype may come in under the
           * brief's ceiling, and a concept that says "low maintenance" has no lawn by design. Judging
           * it against the garden bands would demand grass the palette forbids.
           */
          const context = {
            roomDepth,
            lawnAllowed: concept.maintenance !== 'low' && document.brief.style !== 'lowMaintenance',
          };
          const candidate = PlanDocumentSchema.parse({
            ...document,
            layout: { ...document.layout, elements: concept.elements },
          });
          expect(
            (await new GeometryValidationService(connection!.db).validate(candidate)).violations,
          ).toEqual([]);

          const whole = measureComposition(concept.elements, inScope);
          const room = mainZone ? measureComposition(concept.elements, [mainZone]) : whole;
          if (process.env.COMPOSITION_REPORT === '1') {
            console.log(describeComposition(`${name}/${concept.name}`, whole));
            console.log(describeComposition('  garden only', room));
          } else {
            expect({ concept: concept.name, violations: compositionRules(room, context) }).toEqual({
              concept: concept.name,
              violations: [],
            });
          }
        }
        expect(
          recommended.elements
            .filter((element) => element.fillKind === 'base')
            .every((element) => element.category !== 'planting-bed'),
        ).toBe(true);
        const result = PlanDocumentSchema.parse({
          ...document,
          layout: { ...document.layout, elements: recommended.elements },
        });
        expect(
          (await new GeometryValidationService(connection!.db).validate(result)).violations,
        ).toEqual([]);
        expect(recommended.elements.some((element) => element.category === 'planting-bed')).toBe(
          true,
        );
        if (process.env.CAPTURE_GARDEN_FIXTURES === '1')
          writeFileSync(
            resolve(fixtureDir, `${name}.plan.json`),
            JSON.stringify(result, null, 2) + '\n',
          );
      },
      FIXTURE_TIMEOUT_MS,
    );
  }
});
