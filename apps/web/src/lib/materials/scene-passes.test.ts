import { describe, expect, it } from 'vitest';
import { DesignElementSchema } from '@garden-studio/schema';
import { plantingExclusions, scenePasses } from './scene-passes';
const element = (id: string, category: string, extras = {}) =>
  DesignElementSchema.parse({
    id,
    category,
    zone: 'back',
    role: 'feature',
    shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 4, depth: 4, rotation: 0 },
    ...extras,
  });
describe('physical scene passes', () => {
  it('lays later-added paving below the shadows and tree canopy', () => {
    const tree = element('tree', 'planting-bed', {
      symbol: 'tree-deciduous',
      shape: { kind: 'point', at: { x: 3, y: 3 }, radius: 1 },
    });
    const patio = element('patio', 'paved-area');
    const pergola = element('pergola', 'structure', { symbol: 'pergola' });
    const passes = scenePasses([tree, pergola, patio]);
    expect(passes.ground).toEqual([pergola, patio]);
    expect(passes.objects).toEqual([pergola, tree]);
  });
  /* An aluminium frame has no boards to lay, so it stands on whatever is under it. */
  it('gives a timber pergola a deck and an aluminium one none', () => {
    const timber = element('timber', 'structure', { symbol: 'pergola', material: 'hardwood' });
    const metal = element('metal', 'structure', { symbol: 'pergola', material: 'aluminium-dark' });
    const passes = scenePasses([timber, metal]);
    expect(passes.ground).toEqual([timber]);
    expect(passes.objects).toEqual([timber, metal]);
  });
  /* A floor is laid in the footprint in its own material, in place of any painted deck. */
  it('lays a structure’s floor in the ground pass, as the structure itself', () => {
    const metal = element('metal', 'structure', {
      symbol: 'pergola',
      material: 'aluminium-dark',
      structure: { floor: 'porcelain' },
    });
    const gazebo = element('gazebo', 'structure', { symbol: 'gazebo', structure: { floor: 'stone-setts' } });
    const passes = scenePasses([metal, gazebo]);
    expect(passes.ground.map((item) => [item.id, item.material])).toEqual([
      ['metal', 'porcelain'],
      ['gazebo', 'stone-setts'],
    ]);
    expect(passes.objects).toEqual([metal, gazebo]);
  });
  it('clears nearby furniture and plants without repainting for distant objects', () => {
    const bed = element('bed', 'planting-bed');
    const chair = element('chair', 'furniture');
    const distant = element('distant', 'furniture', {
      shape: { kind: 'point', at: { x: 20, y: 20 }, radius: 1 },
    });
    expect(plantingExclusions(bed, [bed, chair, distant])).toHaveLength(1);
    expect(plantingExclusions(bed, [bed, { ...chair, hidden: true }])).toEqual([]);
  });
});
