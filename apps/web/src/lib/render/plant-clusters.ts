import { boundingBox, moduleRandom, type Point } from '@garden-studio/schema';
import type { RenderPlant, RenderNode } from './scene';

/** Render-lab comparison only; never persisted or included in scene compilation. */
export type PlantingPreview = 'hybrid' | 'individual' | 'masses';
export function plantingLodScale(scale: number, preview: PlantingPreview = 'hybrid'): number {
  return preview === 'individual' ? 40 : preview === 'masses' ? 24 : scale;
}

export interface PlantCluster {
  id: string;
  sourceId: string;
  centre: Point;
  bounds: RenderNode['bounds'];
  plants: RenderPlant[];
  heightTier: RenderPlant['visualLayer'];
  /** Only short vegetation can become a mass without breaking standing-object occlusion. */
  massEligible: boolean;
}

/** A jittered world-space Voronoi field creates rounded drifts instead of square species cells. */
export function plantingClusterAt(seed: string, at: Point): { id: string; centre: Point; family: number } {
  const size = 2.4;
  const col = Math.floor(at.x / size), row = Math.floor(at.y / size);
  let winner = { id: '', centre: at, family: 0 }, nearest = Infinity;
  for (let y = row - 1; y <= row + 1; y++) for (let x = col - 1; x <= col + 1; x++) {
    const random = moduleRandom(`${seed}:drift`, x, y);
    const centre = { x: (x + 0.2 + random() * 0.6) * size, y: (y + 0.2 + random() * 0.6) * size };
    const distance = (at.x - centre.x) ** 2 + (at.y - centre.y) ** 2;
    if (distance < nearest) {
      nearest = distance;
      winner = { id: `${x},${y}`, centre, family: random() };
    }
  }
  return winner;
}

export function compilePlantClusters(plants: RenderPlant[]): PlantCluster[] {
  const groups = new Map<string, { centre: Point; plants: RenderPlant[] }>();
  for (const plant of plants) {
    const field = plantingClusterAt(plant.blob.seed, plant.at);
    const id = `${plant.hostId}:cluster:${plant.visualLayer}:${field.id}`;
    const group = groups.get(id) ?? { centre: field.centre, plants: [] };
    group.plants.push(plant);
    groups.set(id, group);
  }
  return [...groups].map(([id, group]) => {
    const first = group.plants[0]!;
    const bounds = boundingBox(group.plants.flatMap((plant) => [
      { x: plant.at.x - plant.spread * 0.65, y: plant.at.y - plant.spread * 0.65 },
      { x: plant.at.x + plant.spread * 0.65, y: plant.at.y + plant.spread * 0.65 },
    ]));
    return { id, sourceId: first.hostId, centre: group.centre, bounds,
      plants: group.plants, heightTier: first.visualLayer,
      massEligible: group.plants.every((plant) => plant.height < 0.45) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** A continuous transition, independent of DPR. High tiers always remain individual plants. */
export function clusterMassOpacity(cluster: PlantCluster, pxPerMetre: number): number {
  if (!cluster.massEligible) return 0;
  return Math.max(0, Math.min(1, (40 - pxPerMetre) / 16));
}

const clusterIndexes = new WeakMap<PlantCluster[], Map<string, PlantCluster>>();
export function plantMassOpacity(clusters: PlantCluster[], plantId: string, pxPerMetre: number): number {
  let index = clusterIndexes.get(clusters);
  if (!index) {
    index = new Map(clusters.filter((cluster) => cluster.massEligible)
      .flatMap((cluster) => cluster.plants.map((plant) => [plant.id, cluster] as const)));
    clusterIndexes.set(clusters, index);
  }
  const cluster = index.get(plantId);
  return cluster ? clusterMassOpacity(cluster, pxPerMetre) : 0;
}
