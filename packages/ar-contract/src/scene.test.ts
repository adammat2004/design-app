import { describe, expect, it } from 'vitest';
import { flatPolygonMesh } from './mesh-helpers.js';
import {
  AR_SCENE_FORMAT,
  AR_SCENE_VERSION,
  readARScene,
  UnsupportedSceneVersionError,
  type ARScene,
} from './scene.js';

function minimalScene(): ARScene {
  const ring: [number, number][] = [
    [-4, 0],
    [4, 0],
    [4, 8],
    [-4, 8],
  ];
  return {
    format: AR_SCENE_FORMAT,
    version: AR_SCENE_VERSION,
    minReaderVersion: AR_SCENE_VERSION,
    source: {
      projectId: null,
      projectName: 'Test',
      revision: null,
      documentVersion: null,
      layoutFingerprint: null,
      builderVersion: 'test',
      generatedAt: '2026-09-26T00:00:00.000Z',
    },
    frame: {
      units: 'm',
      up: '+y',
      handedness: 'right',
      origin: { kind: 'custom', plan: { x: 0, y: 0 } },
      houseOutward: [0, 1],
      north: null,
      location: null,
    },
    bounds: { min: [-4, 0, 0], max: [4, 2.4, 8] },
    ground: { kind: 'flat', boundary: ring },
    referencePoints: [],
    materials: {
      turf: {
        id: 'turf',
        label: 'Lawn',
        baseColor: '#5f8a3a',
        roughness: 0.9,
        metalness: 0,
        texture: null,
      },
    },
    nodes: [
      {
        id: 'lawn',
        sourceId: null,
        category: 'lawn',
        existing: false,
        visibleByDefault: true,
        kind: 'surface',
        y: 0,
        material: 'turf',
        outline: ring,
        mesh: flatPolygonMesh(ring, 0),
      },
      {
        id: 'bench',
        sourceId: null,
        category: 'furniture',
        existing: false,
        visibleByDefault: true,
        kind: 'model',
        model: 'bench',
        position: [0, 0, 6],
        yaw: 0,
        size: [1.6, 0.9, 0.6],
        fit: 'contain',
        fallback: 'box',
      },
    ],
  };
}

describe('readARScene', () => {
  it('reads a minimal scene', () => {
    expect(readARScene(minimalScene()).nodes).toHaveLength(2);
  });

  it('refuses a scene written for a newer reader, and says so rather than failing validation', () => {
    const newer = { ...minimalScene(), version: 99, minReaderVersion: 99, somethingNew: {} };
    expect(() => readARScene(newer)).toThrow(UnsupportedSceneVersionError);
  });

  it('refuses a node whose material the scene does not define', () => {
    const scene = minimalScene();
    const lawn = scene.nodes[0]!;
    if (lawn.kind !== 'surface') throw new Error('fixture changed');
    lawn.material = 'missing';
    expect(() => readARScene(scene)).toThrow(/does not define/);
  });

  it('refuses a model key the vocabulary does not have', () => {
    const scene = minimalScene() as unknown as { nodes: { model?: string }[] };
    scene.nodes[1]!.model = 'teleporter';
    expect(() => readARScene(scene)).toThrow();
  });
});
