import { describe, expect, it } from 'vitest';
import { CATEGORY_COLOURS, CATEGORY_ORDER } from './concept-colours';
import type { DesignElement, ElementCategory } from './concepts';
import {
  cheaperAlternative,
  defaultMaterial,
  findMaterial,
  MATERIALS,
  materialFill,
  materialLabel,
  materialsFor,
} from './materials';

function element(category: ElementCategory, material?: string): DesignElement {
  return {
    id: 'x',
    category,
    role: 'feature',
    shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 1, depth: 1, rotation: 0 },
    zone: 'back',
    material,
  };
}

describe('MATERIALS', () => {
  it('offers something for every category', () => {
    for (const category of CATEGORY_ORDER) {
      expect(materialsFor(category).length, category).toBeGreaterThan(0);
    }
  });

  it('gives every material a unique id across the whole taxonomy', () => {
    const ids = Object.values(MATERIALS).flatMap((list) => list.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every cost inside the 1–4 band', () => {
    for (const list of Object.values(MATERIALS)) {
      for (const material of list) {
        expect(material.cost).toBeGreaterThanOrEqual(1);
        expect(material.cost).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('defaultMaterial', () => {
  it('is a material the category actually offers', () => {
    for (const category of CATEGORY_ORDER) {
      const id = defaultMaterial(category);
      expect(
        materialsFor(category).some((m) => m.id === id),
        category,
      ).toBe(true);
    }
  });
});

describe('findMaterial and materialLabel', () => {
  it('finds a material without being told its category', () => {
    expect(findMaterial('timber-decking')?.label).toBe('Timber decking');
  });

  it('says so plainly when there is nothing to find', () => {
    expect(findMaterial(undefined)).toBeNull();
    expect(findMaterial('not-a-material')).toBeNull();
    expect(materialLabel(undefined)).toBe('Not specified');
  });
});

describe('materialFill', () => {
  /** The dropdown has to visibly do something, or it is a control that changes nothing. */
  it('uses the material’s own colour when it has one', () => {
    expect(materialFill(element('paved-area', 'timber-decking'))).toBe('#d3c0a3');
    expect(materialFill(element('paved-area', 'concrete'))).toBe('#d6d8d3');
  });

  it('falls back to the category colour when the material has none', () => {
    expect(materialFill(element('existing-feature', 'existing'))).toBe(
      CATEGORY_COLOURS['existing-feature'].fill,
    );
  });

  it('falls back to the category colour when no material is set at all', () => {
    expect(materialFill(element('lawn'))).toBe(CATEGORY_COLOURS.lawn.fill);
  });
});

describe('cheaperAlternative', () => {
  it('finds a cheaper option in the same category', () => {
    const cheaper = cheaperAlternative(element('paved-area', 'stone-pavers'));

    expect(cheaper).not.toBeNull();
    expect(cheaper!.cost).toBeLessThan(4);
    expect(materialsFor('paved-area').some((m) => m.id === cheaper!.id)).toBe(true);
  });

  /** A saving, not a race to the bottom — the dearest of the cheaper options. */
  it('steps down rather than straight to the cheapest', () => {
    const cheaper = cheaperAlternative(element('structure', 'hardwood'));

    expect(cheaper!.cost).toBe(2);
  });

  it('has nothing to offer when the material is already the cheapest', () => {
    expect(cheaperAlternative(element('lawn', 'standard-turf'))).toBeNull();
  });
});
