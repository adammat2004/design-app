import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModelLibrarySchema, type SolidNode } from '@garden-studio/ar-contract';
import { readPlanDocument, type DesignElement, type PlanDocument } from '@garden-studio/schema';
import { previewCounts } from './preview';
import { sceneOfPlan } from './scene';

/*
 * The web's side of the model library: `sceneOfPlan` hands the library to the builder, and the
 * preview's counts see what it carries. The checked-in `library.json` is the one read, so this also
 * fails the day the published file stops parsing.
 */

const FIXTURES = join(__dirname, '../../../scripts/fixtures');
const LIBRARY = ModelLibrarySchema.parse(
  JSON.parse(readFileSync(join(__dirname, '../../../public/models/library/library.json'), 'utf8')),
);
const [first] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.plan.json'))
  .sort();
const document: PlanDocument = readPlanDocument(
  JSON.parse(readFileSync(join(FIXTURES, first!), 'utf8')),
);

const gazebo: DesignElement = {
  id: 'library-gazebo',
  category: 'structure',
  role: 'feature',
  symbol: 'gazebo',
  zone: 'back',
  material: 'dark-stained-timber',
  height: 2.8,
  shape: { kind: 'rect', centre: { x: 6, y: 10 }, width: 3, depth: 3, rotation: 15 },
  structure: { preset: 'classic', roof: { kind: 'hipped', finish: 'shingle-dark' } },
};

const planWith = (elements: DesignElement[]) => ({
  site: document.site,
  elements,
  projectName: 'fixture',
  projectId: null,
  revision: null,
  documentVersion: document.version,
});

describe('sceneOfPlan with the model library', () => {
  it('gives a gazebo the library depicts its model, and counts it', () => {
    const { scene } = sceneOfPlan(
      planWith([...document.layout.elements, gazebo]),
      'desktop',
      LIBRARY,
    );
    const node = scene.nodes.find((candidate) => candidate.sourceId === gazebo.id) as SolidNode;
    expect(node.asset?.id).toBe('gazebo-classic-dark-stained-3x3');
    expect(previewCounts(scene).assets).toBe(1);
  });

  it('gives it none without the library, which is the scene before the library loads', () => {
    const { scene } = sceneOfPlan(planWith([...document.layout.elements, gazebo]), 'desktop');
    expect(previewCounts(scene).assets).toBe(0);
  });
});
