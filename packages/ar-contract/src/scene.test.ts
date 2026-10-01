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

describe('0.0.2 additions', () => {
  it('reads a scene that uses every one of them, and one that uses none', () => {
    const bare = minimalScene();
    expect(() => readARScene(bare)).not.toThrow();

    const rich = minimalScene();
    const material = Object.keys(rich.materials)[0]!;
    rich.materials[material] = { ...rich.materials[material]!, tones: ['#556b2f', '#6b8e23'] };
    rich.nodes.push(
      {
        kind: 'solid',
        id: 'house',
        sourceId: 'house',
        category: 'house',
        existing: true,
        visibleByDefault: true,
        parts: [{ material, mesh: { ...flatPolygonMesh([[0, 0], [1, 0], [1, 1]], 0), uv: 'face' } }],
        openings: [{ kind: 'patio-door', a: [0, 0], b: [1.8, 0], outward: [0, 1], bottom: 0, top: 2.1 }],
      },
      {
        kind: 'plants',
        id: 'bed:plants',
        sourceId: 'bed',
        category: 'planting',
        existing: false,
        visibleByDefault: true,
        plant: 'perennial',
        material,
        species: 'geranium-rozanne',
        instances: [{ at: [1, 0, 1], yaw: 0, spread: 0.6, height: 0.4, tone: 0.5 }],
      },
    );
    expect(() => readARScene(rich)).not.toThrow();
  });

  it('refuses a tone outside 0 to 1 and an opening of a kind it does not know', () => {
    const scene = minimalScene();
    const material = Object.keys(scene.materials)[0]!;
    const plants = {
      kind: 'plants' as const,
      id: 'p',
      sourceId: null,
      category: 'planting' as const,
      existing: false,
      visibleByDefault: true,
      plant: 'perennial' as const,
      material,
      instances: [{ at: [0, 0, 0] as [number, number, number], yaw: 0, spread: 1, height: 1, tone: 1.5 }],
    };
    expect(() => readARScene({ ...scene, nodes: [plants] })).toThrow();
    const door = { kind: 'cat-flap', a: [0, 0], b: [1, 0], outward: [0, 1], bottom: 0, top: 1 };
    const solid = { kind: 'solid', id: 's', sourceId: null, category: 'house', existing: true, visibleByDefault: true,
      parts: [{ material, mesh: flatPolygonMesh([[0, 0], [1, 0], [1, 1]], 0) }], openings: [door] };
    expect(() => readARScene({ ...scene, nodes: [solid] })).toThrow();
  });
});
