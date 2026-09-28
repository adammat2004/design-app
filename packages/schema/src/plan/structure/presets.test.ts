import { describe, expect, it } from 'vitest';
import { rectToPolygon } from '../../geometry/shapes.js';
import type { DesignElement } from '../concepts.js';
import { SYMBOLS } from '../symbols.js';
import { STRUCTURE_SIDES } from './config.js';
import { configureStructure, frontDirection, orientStructure, reexpressRect } from './configure.js';
import {
  applyStructurePreset,
  presetMatches,
  resolveStructure,
  STRUCTURE_DEFINITIONS,
} from './definitions.js';
import { structureParts } from './parts.js';
import { sideSurroundings } from './surroundings.js';

const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  material: 'softwood',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3.6, depth: 3.6, rotation: 0 },
  ...over,
});

const gazebo = (over: Partial<DesignElement> = {}): DesignElement =>
  pergola({ id: 'g1', name: 'Gazebo', symbol: 'gazebo', ...over });

const ringKey = (ring: { x: number; y: number }[]) =>
  ring
    .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)
    .sort()
    .join(' ');

describe('presets', () => {
  /** A structure with nothing stored and one given the classic preset are the same structure. */
  it('makes classic exactly the defaults an unconfigured structure resolves to', () => {
    for (const [symbol, definition] of Object.entries(STRUCTURE_DEFINITIONS)) {
      const classic = definition!.presets[0]!;
      expect(classic.id).toBe(definition!.defaults.preset);
      expect(classic.model).toBe('classic');
      expect(classic.frame).toBe(definition!.defaults.frame);
      expect(classic.roof.kind).toBe(definition!.defaults.roof);
      expect(classic.roof.finish).toBeUndefined();
      expect(classic.lighting).toBe(false);
      for (const side of STRUCTURE_SIDES) expect(classic.sides[side]).toBe('open');
      expect(classic.height).toBe(SYMBOLS[symbol as keyof typeof SYMBOLS].height);
    }
  });

  /** A preset that set a value its own definition does not offer would resolve to something else. */
  it('only ever uses values its definition offers', () => {
    for (const definition of Object.values(STRUCTURE_DEFINITIONS)) {
      const roofKinds = definition!.roof!.kinds.map((kind) => kind.id);
      const sideOptions = definition!.sides!.options.map((option) => option.id);
      for (const preset of definition!.presets) {
        expect(definition!.frameMaterials).toContain(preset.frame);
        expect(roofKinds).toContain(preset.roof.kind);
        if (preset.roof.finish) expect(definition!.roof!.finishes).toContain(preset.roof.finish);
        for (const side of STRUCTURE_SIDES) expect(sideOptions).toContain(preset.sides[side]);
        expect(preset.height).toBeGreaterThanOrEqual(definition!.dimensions.height.min);
        expect(preset.height).toBeLessThanOrEqual(definition!.dimensions.height.max);
      }
    }
  });

  it('applies a whole bundle and resolves back to it', () => {
    for (const definition of Object.values(STRUCTURE_DEFINITIONS)) {
      for (const preset of definition!.presets) {
        const base = definition!.symbol === 'gazebo' ? gazebo() : pergola();
        const applied = applyStructurePreset(base, preset.id);
        const resolved = resolveStructure(applied)!;

        expect(applied.material).toBe(preset.frame);
        expect(applied.height).toBe(preset.height);
        expect(resolved.preset).toBe(preset.id);
        expect(resolved.model).toBe(preset.model);
        expect(resolved.roof.kind).toBe(preset.roof.kind);
        expect(resolved.lighting).toBe(preset.lighting);
        expect(resolved.sides).toEqual(preset.sides);
        expect(presetMatches(applied, preset)).toBe(true);
      }
    }
  });

  it('never changes the size or the place', () => {
    const sized = pergola({
      shape: { kind: 'rect', centre: { x: 3, y: 4 }, width: 4.4, depth: 3.1, rotation: 27 },
    });
    for (const preset of STRUCTURE_DEFINITIONS.pergola!.presets) {
      expect(applyStructurePreset(sized, preset.id).shape).toEqual(sized.shape);
    }
  });

  it('leaves an element alone for a preset it does not have', () => {
    expect(applyStructurePreset(pergola(), 'baroque')).toEqual(pergola());
    expect(applyStructurePreset(pergola({ symbol: 'shed' }), 'classic')).toEqual(
      pergola({ symbol: 'shed' }),
    );
  });

  it('knows when it has been edited', () => {
    const applied = applyStructurePreset(pergola(), 'modern');
    const edited = { ...applied, structure: { ...applied.structure, sides: { left: 'slatted' } } };
    expect(presetMatches(edited, STRUCTURE_DEFINITIONS.pergola!.presets[1]!)).toBe(false);
  });

  /** A plan saved when a preset *was* the frame drawing must still draw that frame. */
  it('draws a legacy modern pergola with the modern frame', () => {
    expect(resolveStructure(pergola({ structure: { preset: 'modern' } }))!.model).toBe('modern');
    expect(resolveStructure(pergola())!.model).toBe('classic');
    expect(resolveStructure(pergola({ structure: { preset: 'baroque' } }))!.model).toBe('classic');
    // A stored model wins over the preset's.
    expect(
      resolveStructure(pergola({ structure: { preset: 'modern', model: 'classic' } }))!.model,
    ).toBe('classic');
  });

  it('builds the frame from the model, not the preset id', () => {
    const postSide = (element: DesignElement) => {
      const post = structureParts(resolveStructure(element)!).find(
        (part) => part.group === 'post',
      )!;
      return post.shape.kind === 'box' ? post.shape.size[0] : null;
    };
    const screened = applyStructurePreset(pergola(), 'screened');
    const classicFrame = { ...screened, structure: { ...screened.structure, model: 'classic' } };
    expect(postSide(screened)).not.toBe(postSide(classicFrame));
  });
});

describe('orientation', () => {
  it('re-describes a rect without moving its ring, in all four quarter turns', () => {
    const rect = {
      kind: 'rect' as const,
      centre: { x: 4, y: 5 },
      width: 3,
      depth: 5,
      rotation: 20,
    };
    for (let k = 0; k < 4; k += 1) {
      expect(ringKey(rectToPolygon(reexpressRect(rect, k)))).toBe(ringKey(rectToPolygon(rect)));
    }
    expect(reexpressRect(rect, 1)).toMatchObject({ width: 5, depth: 3, rotation: 110 });
  });

  it('turns the open front to face the point it is given, and is idempotent', () => {
    const element = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 4, rotation: 0 },
    });
    for (const towards of [
      { x: 20, y: 12 },
      { x: 0, y: 12 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ]) {
      const oriented = orientStructure(element, towards);
      const front = frontDirection(oriented.shape as { rotation: number });
      const to = { x: towards.x - 10, y: towards.y - 12 };
      expect(front.x * to.x + front.y * to.y).toBeGreaterThan(0.99 * Math.hypot(to.x, to.y));
      expect(orientStructure(oriented, towards)).toEqual(oriented);
      expect(ringKey(rectToPolygon(oriented.shape as never))).toBe(
        ringKey(rectToPolygon(element.shape as never)),
      );
    }
  });
});

describe('surroundings', () => {
  it('reads the house behind a structure rotated off the axes', () => {
    const rotation = 37;
    const element = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation },
    });
    const radians = (rotation * Math.PI) / 180;
    const back = { x: Math.sin(radians), y: -Math.cos(radians) };
    const houseCentre = { x: 10 + back.x * (1.5 + 0.1 + 2), y: 12 + back.y * (1.5 + 0.1 + 2) };
    const house = rectToPolygon({ centre: houseCentre, width: 6, depth: 4, rotation });

    const sides = sideSurroundings(element, { elements: [], boundary: BOUNDARY, house });
    expect(sides.rear?.neighbour.kind).toBe('house');
    expect(sides.rear!.gap).toBeLessThan(0.2);
    expect(sides.front).toBeUndefined();
    expect(sides.left).toBeUndefined();
  });
});

describe('configureStructure', () => {
  const site = (towards: { x: number; y: number } | null = null) => ({
    elements: [],
    boundary: BOUNDARY,
    house: null,
    towards,
  });
  const policy = { style: 'cottage' as const, budget: 'medium' as const, lit: true };

  it('gives a generated structure a complete configuration and an explicit height', () => {
    const configured = configureStructure(pergola(), policy, site());
    expect(configured.structure).toMatchObject({ preset: 'classic', model: 'classic' });
    expect(configured.structure?.roof?.kind).toBe('slatted');
    expect(configured.structure?.sides).toEqual({ left: 'open', right: 'open', rear: 'open' });
    expect(configured.height).toBe(2.4);
    expect(STRUCTURE_DEFINITIONS.pergola!.frameMaterials).toContain(configured.material);
  });

  it('gives a modern brief that can afford it the aluminium frame', () => {
    const configured = configureStructure(
      pergola(),
      { style: 'modern', budget: 'high', lit: true, keepFrame: true },
      site(),
    );
    expect(configured.structure?.preset).toBe('modern');
    expect(configured.material).toBe('aluminium-dark');
    expect(configured.structure?.lighting).toBe(true);
  });

  it('keeps the timber frame the cost band was worked out from', () => {
    const configured = configureStructure(pergola(), { ...policy, keepFrame: true }, site());
    expect(configured.material).toBe('softwood');
    expect(resolveStructure(configured)!.roof.finish).toBe('softwood');
  });

  it('does not light a structure in a garden with no lighting', () => {
    const configured = configureStructure(
      pergola(),
      { style: 'modern', budget: 'high', lit: false },
      site(),
    );
    expect(configured.structure?.lighting).toBe(false);
  });

  it('screens only the sides that face the boundary, and only when privacy is wanted', () => {
    // Against the right-hand fence: its right side is 0.6 m off it.
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 17.6, y: 12 }, width: 3.6, depth: 3.6, rotation: 0 },
    });
    const open = configureStructure(byFence, policy, site());
    expect(open.structure?.sides).toEqual({ left: 'open', right: 'open', rear: 'open' });

    const private_ = configureStructure(byFence, { ...policy, privacy: 'enclose' }, site());
    expect(private_.structure?.sides).toEqual({ left: 'open', right: 'slatted', rear: 'open' });
  });

  it('turns its way in towards the terrace before choosing which sides to screen', () => {
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 17.6, y: 12 }, width: 3.6, depth: 3.6, rotation: 0 },
    });
    // The terrace is to the west, so the front faces west and the fence is behind it.
    const configured = configureStructure(
      byFence,
      { ...policy, privacy: 'enclose' },
      site({ x: 5, y: 12 }),
    );
    const front = frontDirection(configured.shape as { rotation: number });
    expect(front.x).toBeCloseTo(-1);
    expect(configured.structure?.sides).toEqual({ left: 'open', right: 'open', rear: 'slatted' });
  });

  it('clamps a structure the placer made bigger than the product down about its centre', () => {
    const huge = gazebo({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 6.5, depth: 6.5, rotation: 0 },
    });
    const configured = configureStructure(huge, policy, site());
    expect(configured.shape).toMatchObject({ width: 5, depth: 5, centre: { x: 10, y: 12 } });
    expect(configured.height).toBe(2.8);
  });

  it('leaves everything that is not a configurable structure alone', () => {
    const shed = pergola({ symbol: 'shed' });
    expect(configureStructure(shed, policy, site({ x: 0, y: 0 }))).toBe(shed);
  });
});
