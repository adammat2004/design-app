import { describe, expect, it } from 'vitest';
import { buildRenderScene } from './build-scene';
import { qualityScene } from './quality-fixtures';
import { RENDER_PASSES } from './primitives';
import { clusterMassOpacity, plantingClusterAt, plantingLodScale } from './plant-clusters';

const all = (scene: ReturnType<typeof buildRenderScene>) => RENDER_PASSES.flatMap((name) => scene.passes[name]);
describe('render primitive compilation', () => {
  it('constructs one shared course between adjacent edged hosts', () => {
    const scene = buildRenderScene(qualityScene('courses'));
    let seamLength = 0;
    for (const p of scene.passes.courses) {
      if (p.kind !== 'linear-course' || !p.sourceId.startsWith('prototype-shared-') || !p.course) continue;
      for (let i = 1; i < p.course.points.length; i++) {
        const a = p.course.points[i - 1]!, b = p.course.points[i]!;
        if (a.x === 3 && b.x === 3) seamLength += Math.abs(b.y - a.y);
      }
    }
    expect(seamLength).toBe(2);
  });
  it('is deterministic and leaves the source document byte-identical', () => {
    const input = qualityScene('target');
    const before = JSON.stringify(input);
    const a = buildRenderScene(input);
    const b = buildRenderScene(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
    expect(new Set(all(a).map((primitive) => primitive.id)).size).toBe(all(a).length);
    expect(a.passes.standing.every((p) => p.kind === 'sprite')).toBe(true);
  });

  it('invalidates changed geometry, but preserves unrelated standing primitive keys', () => {
    const input = qualityScene('target');
    const beds = input.elements.filter((entry) => entry.category === 'planting-bed' && entry.shape.kind === 'rect');
    const moved = beds[0]!;
    const before = buildRenderScene(input);
    const keyOf = (scene: typeof before, id: string) =>
      scene.passes.standing.filter((p) => p.sourceId === id).map((p) => p.cacheKey);
    if (moved.shape.kind !== 'rect') throw new Error('fixture needs a rectangular bed');
    moved.shape.centre.x += 0.4;
    const after = buildRenderScene(input);
    expect(keyOf(after, moved.id)).not.toEqual(keyOf(before, moved.id));
    const untouched = before.passes.standing.find((p) => p.sourceId !== moved.id)!;
    expect(after.passes.standing.find((p) => p.id === untouched.id)!.cacheKey).toBe(untouched.cacheKey);
  });

  it('keeps casters attached to their authored source when another element is inserted', () => {
    const input = qualityScene('target');
    const before = buildRenderScene(input).passes['cast-shadows'];
    input.elements.unshift({ ...input.elements.find((element) => element.symbol === 'tree-deciduous')!, id: 'extra-tree' });
    const after = buildRenderScene(input).passes['cast-shadows'];
    for (const primitive of before) expect(after.find((p) => p.id === primitive.id)).toEqual(primitive);
  });

  it('places light receivers below standing objects and only fixture glow above them', () => {
    const input = qualityScene('reference');
    input.site.sun.minutes = 0;
    const scene = buildRenderScene(input);
    expect(scene.passes['ground-light'][0]?.kind).toBe('ambient');
    expect(scene.passes.emissive.every((p) => p.kind === 'emissive')).toBe(true);
    expect(RENDER_PASSES.indexOf('ground-light')).toBeLessThan(RENDER_PASSES.indexOf('standing'));
    expect(RENDER_PASSES.indexOf('emissive')).toBeGreaterThan(RENDER_PASSES.indexOf('standing'));
  });

  it('keeps unrelated beds stable across a local reshape', () => {
    const input = qualityScene('target');
    const before = buildRenderScene(input);
    const bed = input.elements.find((element) => element.role === 'fill' && element.category === 'planting-bed' && element.shape.kind === 'rect')!;
    if (bed.shape.kind !== 'rect') throw new Error('fixture needs rectangular bed');
    bed.shape.width *= 0.8;
    const after = buildRenderScene(input);
    const unrelated = (scene: typeof before) => scene.clusters.filter((cluster) => cluster.sourceId !== bed.id);
    expect(unrelated(after)).toEqual(unrelated(before));
  });

  it('gives low planting a continuous LOD transition and never flattens tall tiers', () => {
    const scene = buildRenderScene(qualityScene('target'));
    const low = scene.clusters.find((cluster) => cluster.massEligible)!;
    const high = scene.clusters.find((cluster) => !cluster.massEligible)!;
    /*
     * The band is 32 down to 24, and the top of it matters more than the shape. At the ordinary
     * editing zoom of 32 px/m the plants are drawn and the masses are not — no half-and-half, which
     * is what the old 40-to-24 band produced at exactly the zoom people work at: both
     * representations painted at half opacity over each other.
     */
    expect(clusterMassOpacity(low, 24)).toBe(1);
    expect(clusterMassOpacity(low, 28)).toBe(0.5);
    expect(clusterMassOpacity(low, 32)).toBe(0);
    expect(clusterMassOpacity(low, 40)).toBe(0);
    expect(clusterMassOpacity(high, 10)).toBe(0);
    expect(clusterMassOpacity(low, plantingLodScale(32, 'individual'))).toBe(0);
    expect(clusterMassOpacity(low, plantingLodScale(32, 'masses'))).toBe(1);
    expect(clusterMassOpacity(high, plantingLodScale(32, 'masses'))).toBe(0);
    expect(plantingLodScale(32)).toBe(32);
    expect(plantingClusterAt('bed', { x: 4, y: 5 })).toEqual(plantingClusterAt('bed', { x: 4, y: 5 }));
  });
});
