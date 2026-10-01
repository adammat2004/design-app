import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ModelLibrarySchema,
  planToScene,
  yawFromPlanDegrees,
  type ModelLibrary,
  type SolidNode,
} from '@garden-studio/ar-contract';
import { readPlanDocument, type DesignElement, type PlanDocument } from '@garden-studio/schema';
import { buildArScene } from '../build.js';
import type { ArSceneInput } from '../types.js';

/*
 * The builder's half of the model library: a matched structure's solid carries an `AssetRef` that
 * puts the model exactly where the parts are — the same base centre, the same yaw, the element's own
 * size — and keeps the parts. And a library changes nothing about a scene whose structures it does
 * not depict.
 */

const FIXTURES = join(__dirname, '../../../../apps/web/scripts/fixtures');
const GENERATED_AT = '2026-10-01T00:00:00.000Z';
const LIBRARY: ModelLibrary = ModelLibrarySchema.parse(
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/web/public/models/library/library.json'),
      'utf8',
    ),
  ),
);

const fixtures: [string, PlanDocument][] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.plan.json'))
  .sort()
  .map((file) => [file, readPlanDocument(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')))]);

const inputOf = (document: PlanDocument, elements = document.layout.elements): ArSceneInput => ({
  site: document.site,
  elements,
  source: {
    projectId: null,
    projectName: 'fixture',
    revision: null,
    documentVersion: document.version,
  },
});

function gazebo(rotation: number, elevation?: number): DesignElement {
  return {
    id: 'library-gazebo',
    category: 'structure',
    role: 'feature',
    symbol: 'gazebo',
    zone: 'back',
    material: 'dark-stained-timber',
    height: 2.8,
    ...(elevation !== undefined ? { elevation } : {}),
    shape: { kind: 'rect', centre: { x: 7.25, y: 11.5 }, width: 3.1, depth: 2.9, rotation },
    structure: { preset: 'classic', roof: { kind: 'hipped', finish: 'shingle-dark' } },
  };
}

function solidFor(document: PlanDocument, element: DesignElement): SolidNode {
  const { scene } = buildArScene(inputOf(document, [...document.layout.elements, element]), {
    library: LIBRARY,
    generatedAt: GENERATED_AT,
  });
  const node = scene.nodes.find((candidate) => candidate.sourceId === element.id);
  expect(node?.kind).toBe('solid');
  return node as SolidNode;
}

describe('a structure the library depicts', () => {
  const [, document] = fixtures[0]!;

  it('carries the model at the parts’ base centre, yaw and size, at eight rotations', () => {
    for (const rotation of [0, 30, 45, 90, 135, 180, 225, 330]) {
      const element = gazebo(rotation);
      const solid = solidFor(document, element);
      expect(solid.asset, `rotation ${rotation}`).toBeDefined();
      const asset = solid.asset!;
      const expected = planToScene(
        { x: 7.25, y: 11.5 },
        buildArScene(inputOf(document), { generatedAt: GENERATED_AT }).scene.frame.origin.plan,
        0,
      );
      expect(asset.id).toBe('gazebo-classic-dark-stained-3x3');
      for (const axis of [0, 1, 2]) expect(asset.position[axis]).toBeCloseTo(expected[axis]!, 9);
      // The published gazebo is square and may be turned; this one is 3.1 × 2.9, which fits it
      // unturned with less stretch, so it is drawn in the element's own frame.
      expect(asset.yaw).toBeCloseTo(yawFromPlanDegrees(rotation), 12);
      expect(asset.size).toEqual([3.1, 2.8, 2.9]);
    }
  });

  it('stands it on its own raised base, as the parts are', () => {
    const solid = solidFor(document, gazebo(0, 0.45));
    expect(solid.asset!.position[1]).toBeCloseTo(0.45, 12);
    const lowest = Math.min(
      ...solid.parts.flatMap((part) => part.mesh.positions.filter((_, index) => index % 3 === 1)),
    );
    expect(lowest).toBeCloseTo(0.45, 6);
  });

  it('keeps every part, so a renderer without the model draws exactly what it drew before', () => {
    const element = gazebo(30);
    const without = buildArScene(inputOf(document, [...document.layout.elements, element]), {
      generatedAt: GENERATED_AT,
    }).scene.nodes.find((node) => node.sourceId === element.id) as SolidNode;
    const withLibrary = solidFor(document, element);
    expect(without.asset).toBeUndefined();
    const { asset: _asset, ...rest } = withLibrary;
    expect(rest).toEqual(without);
  });

  it('carries nothing for a gazebo the library does not depict, or one drawn as parts by choice', () => {
    const timber = { ...gazebo(0), material: 'hardwood', structure: undefined };
    expect(solidFor(document, timber).asset).toBeUndefined();
    const chosen = { ...gazebo(0), structure: { ...gazebo(0).structure, look: 'procedural' } };
    expect(solidFor(document, chosen).asset).toBeUndefined();
  });
});

describe('every fixture', () => {
  it.each(fixtures)('%s builds the same scene with the library as without it', (_, document) => {
    const without = buildArScene(inputOf(document), { generatedAt: GENERATED_AT });
    const withLibrary = buildArScene(inputOf(document), {
      library: LIBRARY,
      generatedAt: GENERATED_AT,
    });
    expect(withLibrary).toEqual(without);
  });
});
