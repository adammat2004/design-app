import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readARScene } from '@garden-studio/ar-contract';
import { boundaryPolygon, readPlanDocument, type PlanDocument } from '@garden-studio/schema';
import { buildRenderScene } from '../render/build-scene';
import { edgeRulesOf } from '../edge-rules';
import { resolvePattern } from '../materials/palette';
import { BOUNDARY_PALETTE } from '../materials/symbols/boundary';
import { ROOF_TONES } from '../render/roof';
import { materialAppearance, meanColour, multiplyTowards, sceneFileName, sceneOfPlan } from './scene';

const FIXTURES = join(__dirname, '../../../scripts/fixtures');
const fixtures: [string, PlanDocument][] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.plan.json'))
  .sort()
  .map((file) => [file, readPlanDocument(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')))]);

const planOf = (document: PlanDocument) => ({
  site: document.site,
  elements: document.layout.elements,
  projectName: 'fixture',
  projectId: null,
  revision: null,
  documentVersion: document.version,
});

describe.each(fixtures)('%s', (_file, document) => {
  it('plants exactly the plants the plan draws, where it draws them', () => {
    // The whole reason placement moved to the schema: the 3D garden and the 2D plan must be one
    // planting. Every fixture is under the desktop budget, so nothing is thinned here.
    const plan = buildRenderScene({
      boundary: boundaryPolygon(document.site),
      house: document.site.house,
      elements: document.layout.elements,
      site: document.site,
      edgeRules: edgeRulesOf(document.brief),
    });
    const { scene } = sceneOfPlan(planOf(document), 'desktop');
    const origin = scene.frame.origin.plan;
    const key = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const drawn = plan.plants.map((plant) => key(plant.at.x, plant.at.y)).sort();
    const built = scene.nodes
      .flatMap((node) => (node.kind === 'plants' ? node.instances : []))
      .map(({ at }) => key(at[0] + origin.x, at[2] + origin.y))
      .sort();
    expect(built).toEqual(drawn);
  });

  it('colours every ground from the palette the plan is drawn in', () => {
    const { scene } = sceneOfPlan(planOf(document), 'phone');
    expect(() => readARScene(JSON.parse(JSON.stringify(scene)))).not.toThrow();
    for (const node of scene.nodes) {
      if (node.kind !== 'surface') continue;
      const id = node.material.replace(/^material:/, '');
      expect(materialAppearance(id, 'surface'), id).not.toBeNull();
      expect(scene.materials[node.material]!.baseColor).toBe(materialAppearance(id, 'surface')!.baseColor);
    }
    for (const node of scene.nodes) {
      if (node.kind !== 'plants') continue;
      // A bed's plants in its planting's tones, never in the colour of the soil beneath them.
      const id = node.material.replace(/^foliage:/, '');
      expect(node.material.startsWith('foliage:')).toBe(true);
      expect(scene.materials[node.material]!.baseColor).toBe(materialAppearance(id, 'foliage')!.baseColor);
      // Each plant in one of the bed's own tones, as the plan draws it: the palette, whole.
      expect(scene.materials[node.material]!.tones).toEqual(resolvePattern(id)!.palette);
      for (const instance of node.instances) expect(instance.tone).toBeDefined();
    }
  });
});

describe('materialAppearance', () => {
  it('colours a lawn as the plan shows it — the turf photograph under its tint, not the tint alone', () => {
    const lawn = materialAppearance('standard-turf', 'surface')!.baseColor;
    const tint = materialAppearance('standard-turf', 'foliage')!.baseColor;
    const luma = (hex: string) => {
      const v = Number.parseInt(hex.slice(1), 16);
      return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
    };
    // The palette tint is a pale wash; the lawn on the plan is a deep green.
    expect(luma(lawn)).toBeLessThan(luma(tint) * 0.6);
  });
});

describe('the built things', () => {
  it('colours a boundary and a roof as the plan does', () => {
    const [, document] = fixtures.find(([file]) => file === 'suburban.plan.json')!;
    const { scene } = sceneOfPlan(planOf(document), 'phone');
    const roof = document.site.house!.roofMaterial ?? 'slate';
    expect(scene.materials[`roof:${roof}`]!.baseColor).toBe(ROOF_TONES[roof].base);
    for (const [key, material] of Object.entries(scene.materials)) {
      if (!key.startsWith('boundary:')) continue;
      const [kind, part] = key.slice('boundary:'.length).split(':') as [keyof typeof BOUNDARY_PALETTE, string | undefined];
      const palette = BOUNDARY_PALETTE[kind];
      expect(material.baseColor, key).toBe(part === 'detail' ? palette.detail : part === 'cap' ? palette.cap : palette.body);
    }
  });
});

describe('multiplyTowards', () => {
  it('is a low-alpha multiply', () => {
    expect(multiplyTowards('#808080', '#000000', 0)).toBe('#808080');
    expect(multiplyTowards('#808080', '#000000', 1)).toBe('#000000');
    expect(multiplyTowards('#ffffff', '#804020', 0.5)).toBe('#c0a090');
  });
});

describe('meanColour', () => {
  it('averages channel by channel', () => {
    expect(meanColour(['#000000', '#ffffff'])).toBe('#808080');
    expect(meanColour(['#ff0000', '#0000ff'])).toBe('#800080');
    expect(meanColour(['#6a8f47'])).toBe('#6a8f47');
  });
});

describe('sceneFileName', () => {
  it("is the plan's own name, as a file", () => {
    expect(sceneFileName('The Old Rectory')).toBe('the-old-rectory.ar.json');
    expect(sceneFileName('  ')).toBe('garden.ar.json');
  });
});
