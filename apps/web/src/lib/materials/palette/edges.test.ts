import { describe, expect, it } from 'vitest';
import { ElementCategorySchema } from '@garden-studio/schema';
import { CATEGORY_EDGES, edgeFor } from './edges';

describe('edgeFor', () => {
  it('gives a bed a cut edge, which is what makes it a bed rather than a shape on grass', () => {
    expect(edgeFor('planting-bed')).not.toBeNull();
  });

  it('contains aggregate, because gravel is physically held in by something', () => {
    expect(edgeFor('gravel-mulch')).not.toBeNull();
  });

  it('gives water a lip, which is what says it has a depth', () => {
    expect(edgeFor('water-feature')).not.toBeNull();
  });

  it('leaves a lawn alone, because whatever abuts it draws the line', () => {
    expect(edgeFor('lawn')).toBeNull();
  });

  it('leaves paving alone, because its own courses already define it', () => {
    // A line round a patio reads as a border round a photograph.
    expect(edgeFor('paved-area')).toBeNull();
  });

  it('is total, so no caller has to decide what a missing category means', () => {
    for (const category of ElementCategorySchema.options) {
      expect(() => edgeFor(category)).not.toThrow();
      expect(CATEGORY_EDGES).toHaveProperty(category);
    }
  });

  it('quotes widths in millimetres, like every other product dimension', () => {
    // The renderer divides by MM_PER_METRE once at its top edge; nothing below sees a millimetre.
    for (const category of ElementCategorySchema.options) {
      const edge = edgeFor(category);
      if (!edge) continue;

      expect(edge.widthMm).toBeGreaterThan(0);
      // A spade cut, not a kerb. Anything approaching a tenth of a metre is a frame, not an edge.
      expect(edge.widthMm).toBeLessThanOrEqual(100);
      expect(edge.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
