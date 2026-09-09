import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PlanDocumentSchema,
  readPlanDocument,
  rectangleHouse,
  suggestedAccess,
} from '@garden-studio/schema';
import { connectTestDatabase } from '../../test/db.js';
import { ConceptsService } from './concepts.service.js';
import { PlacementService } from './placement.service.js';
import { FillService } from './fill.service.js';
import { GeometryValidationService } from '../geometry-validation.service.js';

const connection = await connectTestDatabase();
afterAll(async () => {
  await connection?.close();
});

// The capture flag is an explicit offline asset-maintenance command. No saved projects are written.
describe.skipIf(!connection)('reference garden fixtures', () => {
  for (const name of ['suburban', 'l-shape', 'courtyard', 'reference']) {
    it(`generates a valid ${name} design`, async () => {
      const fixtureDir = resolve('../web/scripts/fixtures');
      const document =
        name === 'reference'
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
    });
  }
});
