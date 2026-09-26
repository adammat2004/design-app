import {
  PlanDocumentSchema,
  geometryOutline,
  polygonCentroid,
  suggestedAccess,
  type GardenBrief,
  type GeneratedConcept,
  type PlanDocument,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChosenLayout } from './design/choose.js';
import { ConceptsService } from './concepts.service.js';
import { FillService } from './fill.service.js';
import { PlacementService } from './placement.service.js';
import { connectTestDatabase, type TestDatabase } from '../../test/db.js';

/**
 * The preview and the built plan put each feature in the same place.
 *
 * **The top risk the composition work named, and until this test nothing measured it.** The
 * candidate loop chooses a layout by scoring a preview; the realisation then builds that layout with
 * PostGIS, furniture and all. If the two seat a feature in different slots, the concept carries a
 * score for a garden nobody drew — the dining area the loop was pleased with is somewhere else on
 * the card. So every feature the chosen preview placed must come out of realisation with the same
 * purpose (which is the slot's purpose) and near the same point (a nudge is allowed; another slot
 * is not).
 *
 * The preview is captured by wrapping `chooseLayouts`, which passes every call through untouched:
 * nothing the generator does is replaced, only watched.
 */

const captured = vi.hoisted(() => ({ calls: [] as ChosenLayout[][] }));

vi.mock('./design/choose.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./design/choose.js')>();
  return {
    ...original,
    chooseLayouts: (...args: Parameters<typeof original.chooseLayouts>) => {
      const result = original.chooseLayouts(...args);
      captured.calls.push(result);
      return result;
    },
  };
});

const connection = await connectTestDatabase();

const brief: GardenBrief = {
  purpose: 'Somewhere to eat outside and let the children run around.',
  desiredFeatures: ['seating', 'play', 'storage', 'water'],
  featuresOther: '',
  budget: 'medium',
  maintenance: 'medium',
  style: 'modern',
  styleOther: '',
};

function plot(depth: number, over: Partial<GardenBrief> = {}): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: suggestedAccess(
      PlanDocumentSchema.shape.site.parse({
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 20, y: 0 },
          { id: 'v3', x: 20, y: depth },
          { id: 'v4', x: 0, y: depth },
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
      }),
    ),
    brief: { ...brief, ...over },
  });
}

const CASES: { name: string; document: PlanDocument }[] = [
  { name: 'shallow', document: plot(19) },
  { name: 'deep modern', document: plot(30) },
  { name: 'deep cottage', document: plot(30, { style: 'cottage' }) },
  {
    name: 'deep, a fire pit and a shed',
    document: plot(30, { desiredFeatures: ['seating', 'firePit', 'storage', 'dining'] }),
  },
];

/** A nudge moves a footprint up to two metres from its anchor; another slot is further than that. */
const SAME_PLACE = 2.5;

describe.skipIf(connection === null)('the preview and the built plan', { timeout: 60_000 }, () => {
  let service: ConceptsService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new ConceptsService(new PlacementService(db.db), new FillService(db.db));
  });

  afterAll(async () => {
    await db?.close();
  });

  for (const { name, document } of CASES) {
    it(`seat every feature in the same place: ${name}`, async () => {
      captured.calls = [];
      const concepts = await service.generate(document, 11);
      /* Each concept's build asks for all three slots and takes its own. */
      expect(captured.calls.length).toBe(concepts.length);

      for (const [index, concept] of concepts.entries()) {
        const chosen = captured.calls[index]![index % 3];
        if (!chosen) continue;
        expect(concept.strategy?.archetype, `${name} #${index}`).toBe(
          chosen.candidate.fit.archetype.id,
        );

        for (const item of chosen.candidate.preview.placed) {
          const built = hostNamed(concept, item.name);
          const label = `${name} #${index} ${concept.strategy?.archetype}: ${item.name}`;
          expect(built, `${label} was previewed and not built`).toBeDefined();
          /* A hand-drawn sketch's slots carry no purpose, so there is nothing to compare there. */
          if (item.purpose !== undefined) expect(built!.purpose, label).toBe(item.purpose);
          const a = polygonCentroid(item.ring);
          const b = polygonCentroid(geometryOutline(built!.shape));
          expect(Math.hypot(a.x - b.x, a.y - b.y), label).toBeLessThanOrEqual(SAME_PLACE);
        }
      }
    });
  }
});

function hostNamed(concept: GeneratedConcept, name: string) {
  return concept.elements.find(
    (element) => element.role === 'feature' && element.shape.kind !== 'polyline' && element.name === name,
  );
}
