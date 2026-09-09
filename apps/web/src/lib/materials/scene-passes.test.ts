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
