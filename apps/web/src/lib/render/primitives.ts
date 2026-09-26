import { boundingBox, edgingHeight, elementAnchor, elementOutline, type Point, type ShadowOccluder, type SiteSection } from '@garden-studio/schema';
import {
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  MIN_CONTACT_SHADOW_HEIGHT,
} from '../materials/light';
import { LAYER_ORDER } from './visual-layer';
import { fingerprint } from './fingerprint';
import { compileLinearCourse, type LinearCourse } from './linear-course';
import { compilePlantClusters, type PlantCluster } from './plant-clusters';
import type { RenderItem, RenderLight, RenderNode, RenderScene, RenderSurface } from './scene';
import { boundaryContributions, structureContributions } from './depth-fragments';
import { visualBounds } from './projection';
import { footBand, footBandDepth } from '../materials/symbols/elevated';

export const RENDER_PASSES = ['terrain', 'surfaces', 'courses', 'seams', 'cast-shadows', 'contacts',
  'ground-light', 'standing', 'emissive', 'access'] as const;
export type RenderPassName = typeof RENDER_PASSES[number];
export type WorldBounds = RenderNode['bounds'];
export type RendererVersion = 'legacy' | 'v2';

export interface PrimitiveBase {
  id: string;
  sourceId: string;
  pass: RenderPassName;
  bounds: WorldBounds;
  depth: number;
  clip: 'plot' | 'surface' | 'none';
  lod: 'surface' | 'standing' | 'mass' | 'always';
  cacheKey: string;
  localOrder: number;
}
export interface SurfacePrimitive extends PrimitiveBase { kind: 'surface'; item: RenderItem }
export interface LinearCoursePrimitive extends PrimitiveBase {
  kind: 'linear-course'; surface: RenderSurface; course: LinearCourse | null; height: number;
}
export interface SpritePrimitive extends PrimitiveBase { kind: 'sprite'; node: Extract<RenderNode, { kind: 'plant' | 'object' }> }
export interface ExtrusionPrimitive extends PrimitiveBase { kind: 'extrusion'; node: Extract<RenderNode, { kind: 'extrusion' | 'house' }> }
export interface ShadowCaster extends PrimitiveBase { kind: 'shadow-caster'; occluder: ShadowOccluder }
export interface ContactShadowPrimitive extends PrimitiveBase {
  kind: 'contact-shadow'; at: Point; radius: number; character: 'foliage' | 'built';
  /** Opaque bands are unioned with other built contacts before applying pass opacity. */
  outline?: Point[];
}
export interface GroundLightPrimitive extends PrimitiveBase { kind: 'ground-light'; light: RenderLight }
export interface EmissivePrimitive extends PrimitiveBase { kind: 'emissive'; light: RenderLight }
export interface PlantMassPrimitive extends PrimitiveBase { kind: 'plant-mass'; cluster: PlantCluster }
export interface TerrainPrimitive extends PrimitiveBase { kind: 'terrain'; outline: Point[] }
/**
 * One surface that darkens the ground around it. Drawn as a single layer, never per surface —
 * see `render-seam-layer.ts` for why a per-surface raster cannot hold its neighbours' shade.
 */
export interface SeamPrimitive extends PrimitiveBase { kind: 'seam'; outline: Point[] }
export interface AmbientPrimitive extends PrimitiveBase { kind: 'ambient'; night: number }
export interface AccessPrimitive extends PrimitiveBase { kind: 'access'; site: SiteSection }
export type StandingPrimitive = SpritePrimitive | ExtrusionPrimitive;
export type RenderPrimitive = SurfacePrimitive | LinearCoursePrimitive | StandingPrimitive | ShadowCaster |
  ContactShadowPrimitive | GroundLightPrimitive | EmissivePrimitive | PlantMassPrimitive | TerrainPrimitive |
  SeamPrimitive | AmbientPrimitive | AccessPrimitive;
export type RenderPasses = Record<RenderPassName, RenderPrimitive[]>;

export function emptyRenderPasses(): RenderPasses {
  return { terrain: [], surfaces: [], courses: [], seams: [], 'cast-shadows': [], contacts: [],
    'ground-light': [], standing: [], emissive: [], access: [] };
}

type SceneContent = Omit<RenderScene, 'passes' | 'clusters' | 'revision'>;

export function compilePrimitives(scene: SceneContent, site: SiteSection, depthFragments = false) {
  const passes = emptyRenderPasses();
  const clusters = compilePlantClusters(scene.plants);
  const base = (id: string, sourceId: string, pass: RenderPassName, bounds: WorldBounds,
    dependencies: unknown, depth = bounds.minY + bounds.length): PrimitiveBase => ({
    id, sourceId, pass, bounds, depth, clip: 'plot', lod: 'always', localOrder: 0,
    cacheKey: `${id}:${fingerprint(dependencies)}`,
  });
  const add = (primitive: RenderPrimitive) => { passes[primitive.pass].push(primitive); };
  add({ ...base('terrain', 'site', 'terrain', scene.bounds, scene.boundary), kind: 'terrain', outline: scene.boundary });
  for (const item of scene.ground) {
    const bounds = boundingBox(item.surface?.outline ?? elementOutline(item.element));
    const course = item.surface && compileLinearCourse(item.surface);
    if (course && item.surface) {
      add({ ...base(`${item.element.id}:course`, item.element.id, 'courses', boundingBox(course.outline), [item.surface, scene.light]),
        kind: 'linear-course', surface: { ...item.surface, outline: course.outline }, course, height: 0, lod: 'surface', clip: 'surface' });
    } else {
      add({ ...base(`${item.element.id}:ground`, item.element.id, 'surfaces', bounds, [item, scene.light]),
        kind: 'surface', item, lod: 'surface', clip: 'surface' });
    }
    /*
     * What darkens the ground around it, and what does not. A **base fill is the ground** — one per
     * zone, covering the whole of it — so a band round its outline would draw a dark line along
     * every internal zone seam, straight across the middle of a garden where nothing meets
     * anything. Everything laid *on* the ground casts: a bed, a patio, a path, a gravel panel.
     */
    if (item.element.fillKind !== 'base' && item.surface && item.surface.outline.length >= 3) {
      add({ ...base(`${item.element.id}:seam`, item.element.id, 'seams', bounds, item.surface.outline),
        kind: 'seam', outline: item.surface.outline, lod: 'surface' });
    }
  }
  for (const surface of scene.edging) {
    const height = surface.height ?? edgingHeight(surface.element.material);
    const course = compileLinearCourse(surface);
    const rendered = course ? { ...surface, outline: course.outline } : surface;
    add({ ...base(`${surface.elementId}:course`, surface.elementId.split(':edge:')[0]!, 'courses',
      visualBounds(rendered.outline, height), [surface, height, scene.light]), kind: 'linear-course', surface: rendered,
      course, height, lod: 'surface', clip: 'surface' });
  }
  const casterCounts = new Map<string, number>();
  for (const [index, occluder] of scene.shadows.occluders.entries()) {
    const sourceId = scene.shadows.sourceIds[index]!;
    const part = casterCounts.get(sourceId) ?? 0;
    casterCounts.set(sourceId, part + 1);
    add({ ...base(`${sourceId}:caster:${part}`, sourceId, 'cast-shadows', boundingBox(occluder.outline), [occluder, scene.shadows.cast]),
      kind: 'shadow-caster', occluder });
  }
  const standingNodes = scene.stack.flatMap((node) => structureContributions(node, scene.light))
    .flatMap((node) => depthFragments ? boundaryContributions(node, scene.light) : [node]);
  for (const node of standingNodes) {
    const sourceId = node.kind === 'plant' ? node.plant.hostId :
      node.kind === 'extrusion' && node.source.of === 'boundary' ? node.source.run.edgeVertexId :
      node.kind === 'extrusion' && node.source.of === 'level' ? node.source.level.hostId :
      node.kind === 'extrusion' && node.source.of === 'element' ? node.source.element.id : node.id;
    // Edging is a ground course. Its low face is painted with it before cast shadows.
    if (node.kind === 'extrusion' && node.source.of === 'edging') continue;
    const common = { ...base(node.id, sourceId, 'standing', node.bounds, [node, scene.light], node.depth), lod: 'standing' as const };
    if (node.kind === 'plant' || node.kind === 'object') {
      add({ ...common, kind: 'sprite', node });
      const at = node.kind === 'plant' ? node.plant.at : elementAnchor(node.item.element);
      const box = node.kind === 'object' ? boundingBox(elementOutline(node.item.element)) : null;
      const radius = node.kind === 'plant' ? node.plant.spread / 2 : Math.max(box!.width, box!.length) / 2;
      // A mat has nothing standing off the ground to cast; see `MIN_CONTACT_SHADOW_HEIGHT`.
      const grounded = node.kind === 'plant' && node.plant.height < MIN_CONTACT_SHADOW_HEIGHT;
      if (radius > 0 && !grounded) {
        const reach = radius * (CONTACT_SHADOW_SCALE + CONTACT_SHADOW_OFFSET_RATIO);
        add({ ...base(`${node.id}:contact`, sourceId, 'contacts',
          { minX: at.x - reach, minY: at.y - reach, width: reach * 2, length: reach * 2 }, [at, radius, scene.light]),
          kind: 'contact-shadow', at, radius,
          character: node.visualLayer === 'tree' || node.kind === 'plant' ? 'foliage' : 'built' });
      }
    } else {
      add({ ...common, kind: 'extrusion', node });
      // An overhead member has no ground contact. Its posts do, at their true bases.
      const extrusion = node.kind === 'house' ? node.walls : node.contribution === 'beam' ? null : node.extrusion;
      for (const [index, face] of (extrusion?.faces ?? []).entries()) {
        const outline = footBand(face.base[0], face.base[1], footBandDepth(extrusion!.height));
        add({ ...base(`${node.id}:contact:${index}`, sourceId, 'contacts', boundingBox(outline), outline),
          kind: 'contact-shadow', at: face.base[0], radius: 0, outline, character: 'built' });
      }
    }
  }
  // Sort here, once. Backends must not invent their own ordering or category exceptions.
  passes.standing.sort((a, b) => a.depth - b.depth ||
    LAYER_ORDER[(a as StandingPrimitive).node.visualLayer] - LAYER_ORDER[(b as StandingPrimitive).node.visualLayer] ||
    a.localOrder - b.localOrder || a.id.localeCompare(b.id));
  for (const cluster of clusters.filter((candidate) => candidate.massEligible)) {
    add({ ...base(cluster.id, cluster.sourceId, 'contacts', cluster.bounds, cluster),
      kind: 'plant-mass', cluster, lod: 'mass' });
  }
  if (scene.night && scene.night > 0) {
    add({ ...base('ambient', 'site', 'ground-light', scene.bounds, scene.night), kind: 'ambient', night: scene.night });
  }
  for (const light of scene.lights) {
    const bounds = { minX: light.at.x - light.radius, minY: light.at.y - light.radius,
      width: light.radius * 2, length: light.radius * 2 };
    add({ ...base(`${light.id}:pool`, light.id, 'ground-light', bounds, light), kind: 'ground-light', light });
    add({ ...base(`${light.id}:glow`, light.id, 'emissive', bounds, light), kind: 'emissive', light });
  }
  add({ ...base('access', 'site', 'access', scene.bounds, [site.vertices, site.gates, site.streetEdgeVertexId]),
    kind: 'access', site, clip: 'none' });
  const revision = fingerprint(RENDER_PASSES.flatMap((name) => passes[name].map((primitive) => primitive.cacheKey)));
  return { passes, clusters, revision };
}

export function intersects(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.minX + b.width && b.minX <= a.minX + a.width &&
    a.minY <= b.minY + b.length && b.minY <= a.minY + a.length;
}
