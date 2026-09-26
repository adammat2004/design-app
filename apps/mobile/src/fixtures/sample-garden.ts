import {
  AR_SCENE_FORMAT,
  AR_SCENE_VERSION,
  boxMesh,
  flatPolygonMesh,
  mergeMeshes,
  type ARNode,
  type ARScene,
  type Vec2,
  type Vec3,
} from '@garden-studio/ar-contract';

/**
 * A small hand-written garden, so the AR work can start before anything on the web/API side
 * produces scenes.
 *
 * Laid out in scene metres with the origin at the foot of the garden door, +X to the right as you
 * look out of the house and +Z out into the garden. The house runs from X −4 to 4 and back to
 * Z −8; the garden is 10 m wide and 12 m deep behind it:
 *
 *            Z=12 ┌──────────────── back fence ───────────────┐
 *                 │bed │ pergola + dining │                     │
 *             Z=9 │    ├───────────┬──────┘   lawn         tree │
 *                 │tree│path│        (L-shaped)                 │
 *           Z=3.5 │    ├────┴──────────────────────────────────┤
 *                 │    │        patio (bench)                  │
 *             Z=0 └────┴──── house wall, door at X=0 ───────────┘
 *                 X=−5                                        X=5
 *
 * Every ground surface is disjoint from every other, which is the rule the real builder will keep
 * too — see `SurfaceNodeSchema`. Replace this with generated scenes once the builder exists; until
 * then it is the thing to test placement, scale and rendering against.
 */

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

const materials: ARScene['materials'] = {
  porcelain: {
    id: 'porcelain',
    label: 'Porcelain paving',
    baseColor: '#b8b1a4',
    roughness: 0.7,
    metalness: 0,
    texture: { key: 'face-porcelain-tile', tileSizeM: 0.6 },
  },
  setts: {
    id: 'setts',
    label: 'Stone setts',
    baseColor: '#8f8a80',
    roughness: 0.85,
    metalness: 0,
    texture: { key: 'face-stone-setts', tileSizeM: 0.3 },
  },
  turf: {
    id: 'turf',
    label: 'Lawn',
    baseColor: '#6b8f3e',
    roughness: 0.95,
    metalness: 0,
    texture: { key: 'tex-standard-turf', tileSizeM: 1.5 },
  },
  soil: {
    id: 'soil',
    label: 'Planting bed',
    baseColor: '#5a4636',
    roughness: 1,
    metalness: 0,
    texture: { key: 'tex-soil', tileSizeM: 1 },
  },
  softwood: {
    id: 'softwood',
    label: 'Softwood',
    baseColor: '#a7855c',
    roughness: 0.8,
    metalness: 0,
    texture: null,
  },
  fence: {
    id: 'fence',
    label: 'Fence boards',
    baseColor: '#7a5f45',
    roughness: 0.9,
    metalness: 0,
    texture: null,
  },
  render: {
    id: 'render',
    label: 'House render',
    baseColor: '#e8e2d6',
    roughness: 0.9,
    metalness: 0,
    texture: null,
  },
  perennials: {
    id: 'perennials',
    label: 'Mixed perennials',
    baseColor: '#5d7f45',
    roughness: 1,
    metalness: 0,
    texture: null,
  },
};

const surface = (
  id: string,
  category: 'paving' | 'path' | 'lawn' | 'planting',
  material: string,
  outline: Vec2[],
  tileSizeM: number,
): ARNode => ({
  id,
  sourceId: id,
  category,
  existing: false,
  visibleByDefault: true,
  kind: 'surface',
  y: 0,
  material,
  outline,
  mesh: flatPolygonMesh(outline, 0, tileSizeM),
});

/** A 3 × 3 m pergola, 2.4 m to the top of its beams, built from posts, beams and slats. */
function pergola(centre: Vec2): ARNode {
  const [cx, cz] = centre;
  const span = 3;
  const post = 0.1;
  const height = 2.4;
  const inset = span / 2 - post / 2;
  const posts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) =>
    boxMesh([cx + sx! * inset, 0, cz + sz! * inset], [post, height - 0.15, post]),
  );
  const beams = [-1, 1].map((sz) =>
    boxMesh([cx, height - 0.15, cz + sz * inset], [span + 0.3, 0.15, 0.05]),
  );
  const slats = [-1.2, -0.6, 0, 0.6, 1.2].map((dx) =>
    boxMesh([cx + dx, height - 0.05, cz], [0.05, 0.05, span + 0.3]),
  );
  return {
    id: 'pergola',
    sourceId: 'pergola',
    category: 'structure',
    name: 'Dining pergola',
    existing: false,
    visibleByDefault: true,
    kind: 'solid',
    parts: [{ material: 'softwood', mesh: mergeMeshes([...posts, ...beams, ...slats]) }],
  };
}

function fences(): ARNode {
  const height = 1.8;
  const thick = 0.1;
  const runs: [Vec3, Vec3][] = [
    [
      [-5, 0, 6],
      [thick, height, 12],
    ],
    [
      [5, 0, 6],
      [thick, height, 12],
    ],
    [
      [0, 0, 12],
      [10, height, thick],
    ],
  ];
  return {
    id: 'boundary',
    sourceId: 'boundary',
    category: 'boundary',
    name: 'Close-board fence',
    existing: true,
    visibleByDefault: false,
    kind: 'solid',
    parts: [
      { material: 'fence', mesh: mergeMeshes(runs.map(([base, size]) => boxMesh(base, size))) },
    ],
  };
}

/** Two staggered rows of perennials down the left-hand bed, stepping round the tree. */
function bedPlants(): ARNode {
  const instances: Extract<ARNode, { kind: 'plants' }>['instances'] = [];
  for (let i = 0; i < 9; i++) {
    const z = 4 + i * 0.9;
    if (z > 5 && z < 7) continue; // the tree's trunk
    for (const [x, offset] of [
      [-4.6, 0],
      [-3.95, 0.45],
    ] as const) {
      instances.push({
        at: [x, 0, z + offset],
        yaw: (i * 1.3) % (2 * Math.PI),
        spread: 0.6,
        height: 0.7,
      });
    }
  }
  return {
    id: 'bed-plants',
    sourceId: 'bed',
    category: 'planting',
    existing: false,
    visibleByDefault: true,
    kind: 'plants',
    plant: 'perennial',
    material: 'perennials',
    instances,
  };
}

const nodes: ARNode[] = [
  surface('patio', 'paving', 'porcelain', rect(-4, 0, 4, 3.5), 0.6),
  surface('bed', 'planting', 'soil', rect(-5, 3.5, -3.5, 12), 1),
  surface('path', 'path', 'setts', rect(-3.5, 3.5, -2.6, 9), 0.3),
  surface('pergola-floor', 'paving', 'setts', rect(-3.5, 9, 0.5, 12), 0.3),
  surface(
    'lawn',
    'lawn',
    'turf',
    [
      [-2.6, 3.5],
      [5, 3.5],
      [5, 12],
      [0.5, 12],
      [0.5, 9],
      [-2.6, 9],
    ],
    1.5,
  ),
  pergola([-1.5, 10.5]),
  {
    id: 'dining-set',
    sourceId: 'dining-set',
    category: 'furniture',
    name: 'Dining set for four',
    existing: false,
    visibleByDefault: true,
    kind: 'model',
    model: 'dining-set-4',
    position: [-1.5, 0, 10.5],
    yaw: 0,
    size: [2.4, 0.75, 2.4],
    fit: 'contain',
    fallback: 'box',
  },
  {
    id: 'bench',
    sourceId: 'bench',
    category: 'furniture',
    name: 'Bench',
    existing: false,
    visibleByDefault: true,
    kind: 'model',
    model: 'bench',
    position: [2.5, 0, 2.8],
    yaw: Math.PI, // facing the house (−Z); a model's front is +Z at yaw 0
    size: [1.6, 0.9, 0.6],
    fit: 'contain',
    fallback: 'box',
  },
  {
    id: 'tree-back',
    sourceId: 'tree-back',
    category: 'tree',
    name: 'Field maple',
    existing: false,
    visibleByDefault: true,
    kind: 'model',
    model: 'tree-deciduous',
    position: [3.5, 0, 10.5],
    yaw: 0,
    size: [5, 7, 5],
    fit: 'stretch',
    fallback: 'tree',
  },
  {
    id: 'tree-bed',
    sourceId: 'tree-bed',
    category: 'tree',
    name: 'Crab apple',
    existing: false,
    visibleByDefault: true,
    kind: 'model',
    model: 'tree-ornamental',
    position: [-4.25, 0, 6],
    yaw: 0,
    size: [3, 4.5, 3],
    fit: 'stretch',
    fallback: 'tree',
  },
  {
    id: 'bollard',
    sourceId: 'bollard',
    category: 'lighting',
    existing: false,
    visibleByDefault: true,
    kind: 'model',
    model: 'light-bollard',
    position: [-2.4, 0, 6.2],
    yaw: 0,
    size: [0.2, 0.8, 0.2],
    fit: 'contain',
    fallback: 'cylinder',
  },
  bedPlants(),
  fences(),
  {
    id: 'house',
    sourceId: 'house',
    category: 'house',
    existing: true,
    visibleByDefault: false,
    kind: 'solid',
    parts: [{ material: 'render', mesh: boxMesh([0, 0, -4], [8, 6, 8]) }],
  },
];

export const sampleGarden: ARScene = {
  format: AR_SCENE_FORMAT,
  version: AR_SCENE_VERSION,
  minReaderVersion: AR_SCENE_VERSION,
  source: {
    projectId: null,
    projectName: 'Sample garden',
    revision: null,
    documentVersion: null,
    layoutFingerprint: null,
    builderVersion: 'hand-written',
    generatedAt: '2026-09-26T00:00:00.000Z',
  },
  frame: {
    units: 'm',
    up: '+y',
    handedness: 'right',
    origin: { kind: 'garden-door', plan: { x: 5, y: 9 } },
    houseOutward: [0, 1],
    north: [0, -1],
    location: null,
  },
  bounds: { min: [-5, 0, -8], max: [5, 7, 12] },
  ground: { kind: 'flat', boundary: rect(-5, -9, 5, 12) },
  referencePoints: [
    { id: 'house-left', kind: 'house-corner', label: 'Left end of the back wall', at: [-4, 0] },
    { id: 'house-right', kind: 'house-corner', label: 'Right end of the back wall', at: [4, 0] },
    { id: 'door', kind: 'door-centre', label: 'Middle of the garden door', at: [0, 0] },
    {
      id: 'back-left',
      kind: 'boundary-corner',
      label: 'Back-left corner of the garden',
      at: [-5, 12],
    },
    {
      id: 'back-right',
      kind: 'boundary-corner',
      label: 'Back-right corner of the garden',
      at: [5, 12],
    },
  ],
  materials,
  nodes,
};
