import {
  AR_SCENE_FORMAT,
  AR_SCENE_VERSION,
  boxMesh,
  ModelKeySchema,
  planToGround,
  planToScene,
  rotateAboutY,
  yawFromPlanDegrees,
  type ARCategory,
  type ARNode,
  type FallbackShape,
  type Mesh,
  type ModelKey,
  type PlantKey,
  type Vec2,
  type Vec3,
} from '@garden-studio/ar-contract';
import {
  bedPlacementLayers,
  boundaryPolygon,
  elementOutline,
  heightFor,
  isTreeSymbol,
  plantingExclusions,
  plantPlacements,
  pointInPolygon,
  resolveStructure,
  resolveSymbol,
  structureFloor,
  structureParts,
  type DesignElement,
  type ElementCategory,
  type PlacedPlant,
  type Point,
  type StructureFinishId,
  type StyleDirection,
} from '@garden-studio/schema';
import {
  boundaryNodes,
  edgingNodes,
  flightParts,
  hedgingBedNodes,
  houseNode,
  retainingNodes,
} from './depth.js';
import { referencePoints, sceneFrame } from './frame.js';
import { matchLibraryAsset } from './library/match.js';
import { cutSurface, flatMesh, mergeInto, emptyMesh, prismMesh, pyramidMesh } from './mesh.js';
import { MaterialTable } from './materials.js';
import {
  PLANT_BUDGET,
  type ArBuild,
  type ArSceneInput,
  type BuildOptions,
  type SkippedElement,
} from './types.js';

/** Bumped when what the builder emits for the same plan changes. Part of the endpoint's ETag. */
export const BUILDER_VERSION = '0.1.0';

/**
 * How each kind of element reaches the scene. A total `Record`, so a new `ElementCategory` is a
 * compile error here until somebody decides what it is in 3D — the mechanism that keeps a thing on
 * the plan from silently vanishing from the garden a phone shows.
 */
const ROUTE: Record<
  ElementCategory,
  'surface' | 'bed' | 'structure' | 'model' | 'existing' | 'enclosure'
> = {
  lawn: 'surface',
  'planting-bed': 'bed',
  'paved-area': 'surface',
  'gravel-mulch': 'surface',
  'water-feature': 'surface',
  structure: 'structure',
  furniture: 'model',
  lighting: 'model',
  'existing-feature': 'existing',
  // A proposed fence, wall, hedge or kerb is stood up with the boundary runs and the edging.
  enclosure: 'enclosure',
};

/** Structures that are products of one size rather than whatever rectangle the placer gave them. */
const PRODUCT_STRUCTURES = new Set<string>(['hot-tub']);
const PLAY_SYMBOLS = new Set<string>(['swing', 'slide', 'trampoline']);

/**
 * A plan as a scene a 3D renderer can draw: every position, size, yaw and triangle decided here, so
 * the renderer — the phone, or the web's preview — decides nothing about where anything is.
 *
 * Pure: the same plan and options give the same scene (pass `generatedAt` to make that byte-exact).
 * Nothing is inferred that the plan does not say: no ground model, no slope, no roof yet, and a
 * fence the scene cannot draw yet is named in `skipped` rather than guessed at.
 */
export function buildArScene(input: ArSceneInput, options: BuildOptions = {}): ArBuild {
  const { site } = input;
  const elements = input.elements.filter((element) => !element.hidden);
  const frame = sceneFrame(site);
  const origin = frame.origin.plan;
  const ground = (point: Point): Vec2 => planToGround(point, origin);

  const skipped: SkippedElement[] = [];
  const warnings: string[] = [];
  const materials = new MaterialTable(options.appearance);
  const nodes: ARNode[] = [];
  const existing = (element: DesignElement) =>
    element.category === 'existing-feature' || element.status === 'keep';

  /* ---------------------------------------------------------------- the house */
  if (site.house) nodes.push(houseNode(site.house, ground, materials));

  /* ---------------------------------------------------------------- the ground */
  /*
   * A structure's floor is a surface laid in its footprint (`structureFloor`), on top of whatever
   * ground is there: last in the stacking order, so the cut takes the lawn from under it.
   */
  const floorOf = new Map<string, string>();
  const floors = elements.flatMap((element) => {
    const floor = structureFloor(element);
    if (floor) floorOf.set(floor.id, element.id);
    return floor ? [floor] : [];
  });
  const surfaces = [
    ...elements.filter((element) => {
      const route = ROUTE[element.category];
      return route === 'surface' || (route === 'bed' && element.shape.kind !== 'point');
    }),
    ...floors,
  ];
  const rings = surfaces.map((element) => elementOutline(element).map(ground));
  surfaces.forEach((element, index) => {
    const ring = rings[index]!;
    if (ring.length < 3) {
      skipped.push({ elementId: element.id, reason: 'its outline has fewer than three corners' });
      return;
    }
    const category = surfaceCategory(element);
    const material = materials.use(materialKey(element), category);
    let cut = cutSurface(
      ring,
      rings.slice(index + 1).filter((above) => above.length >= 3),
    );
    if (!cut) {
      warnings.push(
        `The cut of ${element.id} failed; it is drawn uncut and may flicker where it overlaps.`,
      );
      cut = [[ring]];
    }
    const mesh = flatMesh(cut, element.elevation ?? 0, materials.tile(material));
    if (mesh.indices.length === 0) {
      if (floorOf.has(element.id)) return;
      skipped.push({ elementId: element.id, reason: 'wholly covered by what is drawn over it' });
      return;
    }
    nodes.push({
      kind: 'surface',
      id: element.id,
      sourceId: floorOf.get(element.id) ?? element.id,
      category,
      ...(element.name ? { name: element.name } : {}),
      existing: existing(element),
      visibleByDefault: true,
      y: element.elevation ?? 0,
      material,
      outline: ring,
      mesh,
    });
  });

  /** Where something standing at `point` stands: on the highest surface under it. */
  const standingHeight = (point: Point, own?: number): number => {
    let height = own ?? 0;
    surfaces.forEach((surface) => {
      const elevation = surface.elevation ?? 0;
      if (elevation > height && pointInPolygon(point, elementOutline(surface))) height = elevation;
    });
    return height;
  };

  /* ---------------------------------------------------------------- everything standing */
  const enclosures: DesignElement[] = [];
  for (const element of elements) {
    const route = ROUTE[element.category];
    if (route === 'surface') continue;
    if (route === 'bed' && element.shape.kind !== 'point') continue;

    if (route === 'enclosure') {
      enclosures.push(element);
      continue;
    }

    if (route === 'structure') {
      const node = structureNode(element, origin, materials, standingHeight, surfaces, {
        library: options.library,
        style: input.edgeRules?.style ?? null,
      });
      if (node) nodes.push(node);
      else skipped.push({ elementId: element.id, reason: 'a structure with no footprint' });
      continue;
    }

    if (route === 'existing') {
      const ring = elementOutline(element).map(ground);
      const height = Math.max(heightFor(element), 0.3);
      if (ring.length < 3) {
        skipped.push({ elementId: element.id, reason: 'its outline has fewer than three corners' });
        continue;
      }
      nodes.push({
        kind: 'solid',
        id: element.id,
        sourceId: element.id,
        category: 'existing',
        ...(element.name ? { name: element.name } : {}),
        existing: true,
        // The real one is in front of the camera; this is only there to be switched on and compared.
        visibleByDefault: false,
        parts: [
          {
            material: materials.use(materialKey(element), 'existing'),
            mesh: prismMesh(ring, element.elevation ?? 0, height),
          },
        ],
      });
      continue;
    }

    // A product: furniture, a light, a tree or a shrub standing on a point.
    const model = modelFor(element);
    if (!model) {
      skipped.push({ elementId: element.id, reason: 'no model names what this is' });
      continue;
    }
    const { centre, size, rotation } = footprintOf(element);
    const y = standingHeight(centre, element.elevation);
    nodes.push({
      kind: 'model',
      id: element.id,
      sourceId: element.id,
      category: model.category,
      ...(element.name ? { name: element.name } : {}),
      existing: existing(element),
      visibleByDefault: true,
      model: model.key,
      position: planToScene(centre, origin, y),
      yaw: yawFromPlanDegrees(rotation),
      size: [size.width, Math.max(heightFor(element), 0.05), size.depth],
      fit: model.category === 'tree' || model.category === 'shrub' ? 'stretch' : 'contain',
      fallback: model.fallback,
      ...(element.plantId ? { species: element.plantId } : {}),
    });
  }

  /* ---------------------------------------------------------------- the garden's depth */
  nodes.push(...retainingNodes(elements, site.house, ground, materials));
  nodes.push(...hedgingBedNodes(elements, ground, materials));
  const edging = edgingNodes(elements, site, input.edgeRules, ground, materials);
  nodes.push(...edging.nodes);
  const boundaries = boundaryNodes(site, elements, ground, materials);
  nodes.push(...boundaries.nodes);
  for (const element of enclosures) {
    if (boundaries.drawn.has(element.id) || edging.drawn.has(element.id)) continue;
    skipped.push({
      elementId: element.id,
      reason: 'an opening in the boundary, which builds nothing',
    });
  }

  /* ---------------------------------------------------------------- the beds' infill */
  nodes.push(...plantNodes(elements, origin, materials, PLANT_BUDGET[options.plants ?? 'desktop']));

  const boundary = boundaryPolygon(site).map(ground);
  return {
    scene: {
      format: AR_SCENE_FORMAT,
      version: AR_SCENE_VERSION,
      minReaderVersion: AR_SCENE_VERSION,
      source: {
        ...input.source,
        layoutFingerprint: null,
        builderVersion: BUILDER_VERSION,
        generatedAt: options.generatedAt ?? new Date().toISOString(),
      },
      frame,
      bounds: boundsOf(nodes, boundary),
      ground: { kind: 'flat', boundary },
      referencePoints: referencePoints(site, origin),
      materials: materials.table(),
      nodes: nodes.map(withFaceUvs),
    },
    skipped,
    warnings,
  };
}

/**
 * A solid's UVs are metres along each face (`uv: 'face'`, contract 0.0.2): boxes, walls, posts and
 * roofs are all built that way, and world XZ would smear a texture straight down every wall.
 * Surfaces keep the default, world XZ, which is what lets two abutting patios share one pattern.
 */
function withFaceUvs(node: ARNode): ARNode {
  if (node.kind !== 'solid') return node;
  return {
    ...node,
    parts: node.parts.map((part) => ({ ...part, mesh: { ...part.mesh, uv: 'face' as const } })),
  };
}

/* ------------------------------------------------------------------ surfaces */

function surfaceCategory(element: DesignElement): ARCategory {
  const line = element.shape.kind === 'polyline';
  switch (element.category) {
    case 'lawn':
      return 'lawn';
    case 'planting-bed':
      return 'planting';
    case 'water-feature':
      return 'water';
    case 'gravel-mulch':
      return line ? 'path' : 'gravel';
    default:
      return line ? 'path' : (element.material ?? '').includes('decking') ? 'decking' : 'paving';
  }
}

function materialKey(element: DesignElement): string {
  return `material:${element.material ?? element.category}`;
}

/* ------------------------------------------------------------------ structures */

function structureNode(
  element: DesignElement,
  origin: Point,
  materials: MaterialTable,
  standingHeight: (point: Point, own?: number) => number,
  surfaces: DesignElement[],
  models: { library: BuildOptions['library']; style: StyleDirection | null },
): ARNode | null {
  const symbol = resolveSymbol(element);
  const { centre, rotation } = footprintOf(element);

  if (symbol && PRODUCT_STRUCTURES.has(symbol)) {
    const { size } = footprintOf(element);
    return {
      kind: 'model',
      id: element.id,
      sourceId: element.id,
      category: 'structure',
      ...(element.name ? { name: element.name } : {}),
      existing: element.status === 'keep',
      visibleByDefault: true,
      model: symbol as ModelKey,
      position: planToScene(centre, origin, standingHeight(centre, element.elevation)),
      yaw: yawFromPlanDegrees(rotation),
      size: [size.width, Math.max(heightFor(element), 0.05), size.depth],
      fit: 'contain',
      fallback: 'box',
    };
  }

  const base = element.elevation ?? 0;
  const resolved = resolveStructure(element);
  if (resolved) {
    /*
     * A configurable structure is built from its own parts — the same `structureParts` the plan
     * symbol, the shadows and the 3D editor read — in its local frame (X across, Z towards its open
     * front, origin on the ground at its centre), then turned by its yaw and moved to its centre.
     * Parts that share a finish share one mesh: one draw call per finish, not per rafter.
     */
    const yaw = yawFromPlanDegrees(rotation);
    const at = planToScene(centre, origin, base);
    const byFinish = new Map<StructureFinishId, Mesh>();
    for (const part of structureParts(resolved)) {
      const mesh = byFinish.get(part.finish) ?? emptyMesh();
      const [lx, ly, lz] = part.shape.centre;
      const [ox, oz] = rotateAboutY([lx, lz], yaw);
      if (part.shape.kind === 'box') {
        const [w, h, d] = part.shape.size;
        mergeInto(mesh, boxMesh([at[0] + ox, base + ly - h / 2, at[2] + oz], [w, h, d], yaw));
      } else {
        const [w, d] = part.shape.base;
        mergeInto(
          mesh,
          pyramidMesh([at[0] + ox, base + ly, at[2] + oz], w, d, part.shape.rise, yaw),
        );
      }
      byFinish.set(part.finish, mesh);
    }
    /*
     * A library model that depicts exactly this configuration and fits its size may draw it instead
     * — at the same base centre and yaw the parts were built at, scaled to the same size, so the two
     * drawings cannot disagree about where the structure is. The parts stay: they are what a renderer
     * without the model, or still loading it, draws.
     */
    const outcome = matchLibraryAsset(element, models.library, { style: models.style });
    const asset =
      outcome.kind === 'model'
        ? {
            id: outcome.match.entry.id,
            position: at,
            yaw: yaw + (outcome.match.turned ? Math.PI / 2 : 0),
            size: outcome.match.size,
          }
        : null;
    return {
      kind: 'solid',
      id: element.id,
      sourceId: element.id,
      category: 'structure',
      ...(element.name ? { name: element.name } : {}),
      existing: element.status === 'keep',
      visibleByDefault: true,
      parts: [...byFinish].map(([finish, mesh]) => ({ material: materials.finish(finish), mesh })),
      ...(asset ? { asset } : {}),
    };
  }

  const material = materials.use(materialKey(element), symbol === 'steps' ? 'steps' : 'structure');
  if (symbol === 'steps') {
    const parts = flightParts(element, surfaces, origin, material);
    if (parts) {
      return {
        kind: 'solid',
        id: element.id,
        sourceId: element.id,
        category: 'steps',
        ...(element.name ? { name: element.name } : {}),
        existing: element.status === 'keep',
        visibleByDefault: true,
        parts,
      };
    }
  }

  // Any other structure — a shed, a garden room, a raised bed — as the block it occupies, until its
  // own parts builder exists.
  const ring = elementOutline(element).map((point) => planToGround(point, origin));
  if (ring.length < 3) return null;
  return {
    kind: 'solid',
    id: element.id,
    sourceId: element.id,
    category: symbol === 'steps' ? 'steps' : 'structure',
    ...(element.name ? { name: element.name } : {}),
    existing: element.status === 'keep',
    visibleByDefault: true,
    parts: [
      {
        material,
        // A flight's `elevation` is the rise it climbs, so it stands from the ground up to it.
        mesh:
          symbol === 'steps'
            ? prismMesh(ring, 0, Math.max(base, 0.15))
            : prismMesh(ring, base, Math.max(heightFor(element), 0.05)),
      },
    ],
  };
}

/* ------------------------------------------------------------------ models */

function modelFor(
  element: DesignElement,
): { key: ModelKey; category: ARCategory; fallback: FallbackShape } | null {
  const symbol = resolveSymbol(element);
  if (element.category === 'planting-bed') {
    // A placed plant: its own symbol, or by its size where it has none.
    const tree = symbol
      ? isTreeSymbol(symbol)
      : element.shape.kind === 'point' && element.shape.radius >= 1.2;
    const key =
      symbol && ModelKeySchema.safeParse(symbol).success
        ? (symbol as ModelKey)
        : tree
          ? 'tree-deciduous'
          : 'shrub-flowering';
    return { key, category: tree ? 'tree' : 'shrub', fallback: tree ? 'tree' : 'cylinder' };
  }
  if (!symbol || !ModelKeySchema.safeParse(symbol).success) return null;
  if (element.category === 'lighting')
    return { key: symbol as ModelKey, category: 'lighting', fallback: 'cylinder' };
  return {
    key: symbol as ModelKey,
    category: PLAY_SYMBOLS.has(symbol) ? 'play' : 'furniture',
    fallback: 'box',
  };
}

/** Where a thing stands, how big its footprint is, and which way it is turned. */
function footprintOf(element: DesignElement): {
  centre: Point;
  size: { width: number; depth: number };
  rotation: number;
} {
  const shape = element.shape;
  if (shape.kind === 'rect') {
    return {
      centre: shape.centre,
      size: { width: shape.width, depth: shape.depth },
      rotation: shape.rotation ?? 0,
    };
  }
  if (shape.kind === 'point') {
    return {
      centre: shape.at,
      size: { width: shape.radius * 2, depth: shape.radius * 2 },
      rotation: 0,
    };
  }
  const ring = elementOutline(element);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: { width: Math.max(maxX - minX, 0.05), depth: Math.max(maxY - minY, 0.05) },
    rotation: 0,
  };
}

/* ------------------------------------------------------------------ plants */

/**
 * Every bed's infill, placed exactly as the plan places it (`plantPlacements`), then thinned to the
 * profile's budget by **one ranking over the whole garden**: each plant's id hashed to a number,
 * lowest first. The ranking does not depend on the budget, so the phone's few hundred are a subset of
 * the desktop's thousands — a sparser version of the same garden, never a different planting — and
 * editing one bed never reshuffles which plants another keeps beyond the budget's edge.
 */
function plantNodes(
  elements: DesignElement[],
  origin: Point,
  materials: MaterialTable,
  budget: number,
): ARNode[] {
  const placed: { bed: DesignElement; plant: PlacedPlant; species: string | null; rank: number }[] =
    [];
  for (const bed of elements) {
    if (bed.category !== 'planting-bed' || bed.shape.kind === 'point' || !bed.material) continue;
    const { layers, hasPlanting } = bedPlacementLayers(bed.material, bed);
    if (!hasPlanting) continue;
    const outline = elementOutline(bed);
    for (const plant of plantPlacements(
      bed,
      layers,
      outline,
      plantingExclusions(bed, elements),
      hasPlanting,
    )) {
      const species =
        typeof plant.layer === 'number' ? (layers[plant.layer]?.species?.id ?? null) : null;
      placed.push({ bed, plant, species, rank: rankOf(plant.id) });
    }
  }
  const kept = new Set(
    [...placed]
      .sort(
        (a, b) =>
          a.rank - b.rank || (a.plant.id < b.plant.id ? -1 : a.plant.id > b.plant.id ? 1 : 0),
      )
      .slice(0, budget)
      .map((entry) => entry.plant.id),
  );

  const groups = new Map<
    string,
    {
      bed: DesignElement;
      key: PlantKey;
      species: string | null;
      instances: { at: Vec3; yaw: number; spread: number; height: number; tone: number }[];
    }
  >();
  for (const { bed, plant, species } of placed) {
    if (!kept.has(plant.id)) continue;
    const key = plantKeyOf(plant);
    // One node per bed, form and species: a mix's lavender and its geranium stay two things.
    const id = `${bed.id}:plants:${key}${species ? `:${species}` : ''}`;
    const group = groups.get(id) ?? { bed, key, species, instances: [] };
    group.instances.push({
      at: planToScene(plant.at, origin, bed.elevation ?? 0),
      // A plan sprite turns freely for variety; so does the clump. Negated only to keep the plan's
      // clockwise sense, as every other yaw does.
      yaw: -plant.rotation || 0,
      spread: plant.spread,
      height: Math.max(plant.height, 0.05),
      tone: plant.tone,
    });
    groups.set(id, group);
  }

  return [...groups].map(([id, group]): ARNode => ({
    kind: 'plants',
    id,
    sourceId: group.bed.id,
    category: group.key === 'shrub-mass' ? 'shrub' : 'planting',
    existing: group.bed.status === 'keep',
    visibleByDefault: true,
    plant: group.key,
    material: materials.use(`foliage:${group.bed.material ?? group.bed.category}`, 'shrub'),
    ...(group.species ? { species: group.species } : {}),
    instances: group.instances,
  }));
}

function plantKeyOf(plant: PlacedPlant): PlantKey {
  if (plant.taxonType === 'ground-cover') return 'groundcover';
  if (plant.taxonType === 'grass-ornamental') return 'grass';
  if (plant.taxonType === 'shrub' || plant.role === 'backdrop') return 'shrub-mass';
  return 'perennial';
}

/** FNV-1a over the id, as a unit interval. Stable across runs, machines and engines. */
export function rankOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/* ------------------------------------------------------------------ bounds */

function boundsOf(nodes: ARNode[], boundary: Vec2[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, 0, Infinity];
  const max: Vec3 = [-Infinity, 0, -Infinity];
  const take = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };
  for (const [x, z] of boundary) take(x, 0, z);
  const takeMesh = (mesh: Mesh) => {
    for (let i = 0; i < mesh.positions.length; i += 3)
      take(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!);
  };
  for (const node of nodes) {
    if (node.kind === 'surface') takeMesh(node.mesh);
    else if (node.kind === 'solid') node.parts.forEach((part) => takeMesh(part.mesh));
    else if (node.kind === 'model') {
      const [x, y, z] = node.position;
      const reach = Math.hypot(node.size[0], node.size[2]) / 2;
      take(x - reach, y, z - reach);
      take(x + reach, y + node.size[1], z + reach);
    } else {
      for (const instance of node.instances) {
        const [x, y, z] = instance.at;
        take(x - instance.spread / 2, y, z - instance.spread / 2);
        take(x + instance.spread / 2, y + instance.height, z + instance.spread / 2);
      }
    }
  }
  return { min, max };
}
