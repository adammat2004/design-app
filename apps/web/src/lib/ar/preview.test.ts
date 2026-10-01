import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planToGround, type ModelNode } from '@garden-studio/ar-contract';
import { readPlanDocument, rectToPolygon, type DesignElement } from '@garden-studio/schema';
import { cameraView, DOOR_SETBACK, EYE_HEIGHT, meshGeometry, modelRing, previewCounts, sceneFrameOf } from './preview';
import { sceneOfPlan } from './scene';

const document = readPlanDocument(
  JSON.parse(readFileSync(join(__dirname, '../../../scripts/fixtures/suburban.plan.json'), 'utf8')),
);
const plan = (elements: DesignElement[] = document.layout.elements) => ({
  site: document.site,
  elements,
  projectName: 'suburban',
  projectId: null,
  revision: null,
  documentVersion: document.version,
});
const { scene } = sceneOfPlan(plan(), 'desktop');

describe('previewCounts', () => {
  it('counts nodes, and plants by the instance', () => {
    const counts = previewCounts(scene);
    expect(counts.surfaces).toBe(scene.nodes.filter((node) => node.kind === 'surface').length);
    expect(counts.solids).toBe(scene.nodes.filter((node) => node.kind === 'solid').length);
    expect(counts.plants).toBe(
      scene.nodes.reduce((sum, node) => sum + (node.kind === 'plants' ? node.instances.length : 0), 0),
    );
    expect(counts.plants).toBeGreaterThan(counts.surfaces);
  });
});

describe('cameraView', () => {
  it('stands in the doorway at eye height, looking out the way the house faces', () => {
    const { position, target } = cameraView(scene, 'door');
    const [ox, oz] = scene.frame.houseOutward!;
    expect(position[1]).toBe(EYE_HEIGHT);
    // Back inside the house, so the terrace across the doors is in front of the lens.
    expect(position[0] * ox + position[2] * oz).toBeCloseTo(-DOOR_SETBACK, 9);
    // Looking out, not back into the house, and a little down.
    expect((target[0] - position[0]) * ox + (target[2] - position[2]) * oz).toBeGreaterThan(5);
    expect(target[1]).toBeLessThan(position[1]);
  });

  it('looks back at the house from above the far end for the overview', () => {
    const { position, target } = cameraView(scene, 'overview');
    const { min, max } = scene.bounds;
    const [ox, oz] = scene.frame.houseOutward!;
    expect(target).toEqual([(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2]);
    // On the garden's side of the middle, not behind the house.
    expect((position[0] - target[0]) * ox + (position[2] - target[2]) * oz).toBeGreaterThan(0);
    expect(position[1]).toBeGreaterThan(Math.hypot(max[0] - min[0], max[2] - min[2]) * 0.4);
  });
});

describe('modelRing', () => {
  for (const rotation of [0, 30, 90, 205]) {
    it(`gives a piece turned ${rotation}° back its plan corners, in the plan's order`, () => {
      const table: DesignElement = {
        id: 'table',
        category: 'furniture',
        role: 'feature',
        zone: 'back',
        symbol: 'dining-set-4',
        shape: { kind: 'rect', centre: { x: 6, y: 20 }, width: 2.2, depth: 1.6, rotation },
      };
      const built = sceneOfPlan(plan([table]), 'desktop').scene;
      const node = built.nodes.find((candidate): candidate is ModelNode => candidate.id === 'table')!;
      const expected = rectToPolygon(table.shape as Extract<DesignElement['shape'], { kind: 'rect' }>).map(
        (point) => planToGround(point, built.frame.origin.plan),
      );
      modelRing(node).forEach((corner, index) => {
        expect(corner.x).toBeCloseTo(expected[index]![0], 9);
        expect(corner.z).toBeCloseTo(expected[index]![1], 9);
      });
    });
  }
});

describe('sceneFrameOf', () => {
  it('is the scene origin both ways', () => {
    const frame = sceneFrameOf(scene);
    const point = { x: 3.25, y: 17.5 };
    const local = frame.toLocal(point);
    expect(local.x).toBeCloseTo(point.x - scene.frame.origin.plan.x, 12);
    expect(frame.toPlan(local)).toEqual(point);
  });
});

describe('meshGeometry', () => {
  it('uploads the arrays as they are', () => {
    const surface = scene.nodes.find((node) => node.kind === 'surface')!;
    if (surface.kind !== 'surface') throw new Error('no surface');
    const geometry = meshGeometry(surface.mesh);
    expect(geometry.getAttribute('position').count).toBe(surface.mesh.positions.length / 3);
    expect(geometry.getIndex()!.count).toBe(surface.mesh.indices.length);
  });
});
