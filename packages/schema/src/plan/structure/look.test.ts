import { describe, expect, it } from 'vitest';
import type { DesignElement } from '../concepts.js';
import { mergeStructureConfig } from './config.js';
import { applyStructurePreset } from './definitions.js';

const gazebo: DesignElement = {
  id: 'g1',
  category: 'structure',
  role: 'feature',
  symbol: 'gazebo',
  zone: 'back',
  height: 2.8,
  shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 3, depth: 3, rotation: 0 },
};

describe('structure.look', () => {
  it('is set and cleared through the ordinary patch, like every other field', () => {
    const pinned = mergeStructureConfig(undefined, { look: 'gazebo-classic-dark-stained-3x3' });
    expect(pinned.look).toBe('gazebo-classic-dark-stained-3x3');
    expect(mergeStructureConfig(pinned, { look: undefined }).look).toBeUndefined();
  });

  it('survives a change of preset, because which drawing somebody prefers is not part of a style', () => {
    const procedural = { ...gazebo, structure: { look: 'procedural' } };
    expect(applyStructurePreset(procedural, 'modern').structure?.look).toBe('procedural');
    expect(applyStructurePreset(gazebo, 'modern').structure).not.toHaveProperty('look');
  });
});
