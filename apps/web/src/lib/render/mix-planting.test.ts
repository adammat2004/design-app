import { describe, expect, it } from 'vitest';
import {
  PLANTING_MIXES,
  SiteSectionSchema,
  speciesById,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { resolvePattern } from '../materials/palette';
import { resolveLayers } from '../materials/layers';
import { canopySpriteBox } from '../materials/symbols/canopy';
import { buildRenderScene } from './build-scene';

const BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 18 },
  { x: 0, y: 18 },
];

function bed(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'b1',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    material: 'mix-pollinator',
    zone: 'back',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 8 },
        { x: 2, y: 8 },
      ],
    },
    ...over,
  } as DesignElement;
}

function plantsOf(elements: DesignElement[]) {
  return buildRenderScene({
    boundary: BOUNDARY,
    house: null,
    elements,
    site: SiteSectionSchema.parse({
      vertices: BOUNDARY.map((point, index) => ({ ...point, id: `v${index}` })),
      closed: true,
    }),
  }).plants;
}

describe('a planting mix, drawn', () => {
  it('is a ground and one layer per species, each pinned to its own picture', () => {
    const layers = resolveLayers(resolvePattern('mix-pollinator')!, bed());
    const mix = PLANTING_MIXES['mix-pollinator']!.mix;
    expect(layers).toHaveLength(mix.length + 1);
    const pins = layers.slice(1).map((layer) => layer.assets?.pin?.family);
    for (const entry of mix) expect(pins).toContain(speciesById(entry.speciesId)!.art.family);
  });

  /** The lavender is the lavender picture, not whichever perennial the drift happened to choose. */
  it('plants every species in the bed as itself', () => {
    const plants = plantsOf([bed()]);
    const drawn = new Set(plants.map((plant) => `${plant.assetId}#${plant.variant}`));
    const lavender = speciesById('lavandula-hidcote')!.art;
    expect(drawn.has(`${lavender.family}#${lavender.variant}`)).toBe(true);
    expect(plants.length).toBeGreaterThan(40);
  });

  it('draws a bed’s own mix over its material’s', () => {
    const own = bed({ material: 'mixed-border', planting: { mix: [{ speciesId: 'vinca-minor', share: 1 }] } });
    const vinca = speciesById('vinca-minor')!.art;
    const assets = new Set(plantsOf([own]).map((plant) => `${plant.assetId}#${plant.variant}`));
    expect([...assets]).toEqual([`${vinca.family}#${vinca.variant}`]);
  });

  it('leaves a bed of an older material drawn as it always was', () => {
    const layers = resolveLayers(resolvePattern('mixed-border')!, bed({ material: 'mixed-border', plantingStyle: 'cottage' }));
    expect(layers.some((layer) => layer.assets?.pin)).toBe(false);
  });
});

describe('a tree with a species', () => {
  /** Pinning changes which picture, never how the crown is turned. */
  it('keeps the rotation its seed gave it', () => {
    const ratio = () => 1;
    const free = canopySpriteBox({ x: 3, y: 4 }, 40, 'e-7', 3, ratio);
    const pinned = canopySpriteBox({ x: 3, y: 4 }, 40, 'e-7', 3, ratio, 2);
    expect(pinned.variant).toBe(2);
    expect(pinned.rotation).toBe(free.rotation);
  });
});
