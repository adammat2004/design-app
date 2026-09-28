import { describe, expect, it } from 'vitest';
import {
  applyStructurePreset,
  FRAME_MODELS,
  resolveStructure,
  STRUCTURE_DEFINITIONS,
  type DesignElement,
} from '@garden-studio/schema';
import { modelFor } from './model-registry';

const structure = (symbol: string): DesignElement => ({
  id: symbol,
  category: 'structure',
  role: 'feature',
  zone: 'back',
  symbol,
  shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 3, depth: 3, rotation: 0 },
});

describe('the model registry', () => {
  /** Whatever a saved plan says, the 3D view has something to draw it with. */
  it('resolves every preset of every structure to a model that builds parts', () => {
    for (const definition of Object.values(STRUCTURE_DEFINITIONS)) {
      for (const preset of definition!.presets) {
        const resolved = resolveStructure(
          applyStructurePreset(structure(definition!.symbol), preset.id),
        )!;
        const model = modelFor(resolved);
        expect(model.build(resolved).length, `${definition!.symbol} ${preset.id}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('keys on the stored frame model, which is what the document persists', () => {
    for (const { id } of FRAME_MODELS) {
      const resolved = resolveStructure({ ...structure('pergola'), structure: { model: id } })!;
      expect(resolved.model).toBe(id);
      expect(modelFor(resolved).kind).toBe('procedural');
    }
  });
});
