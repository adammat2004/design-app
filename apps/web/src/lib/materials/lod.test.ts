import { describe, expect, it } from 'vitest';
import { materialPattern, MM_PER_METRE, type MaterialPattern } from '@garden-studio/schema';
import { MIN_DRAWN_MODULE_PX, MIN_DRAWN_UNIT_PX, MIN_SHADED_PX, shadesAt, tierFor } from './lod';

const slab = materialPattern('stone-pavers')! as Extract<MaterialPattern, { patternType: 'grid' }>;
const gravel = materialPattern('decorative-gravel')! as Extract<
  MaterialPattern,
  { patternType: 'scatter' }
>;
const turf = materialPattern('standard-turf')!;
const pond = materialPattern('naturalistic-pond')!;

/** The zoom at which a thing of this size in millimetres is exactly `px` pixels across. */
const zoomFor = (mm: number, px: number) => (px * MM_PER_METRE) / mm;

describe('tierFor', () => {
  it('collapses paving to a mass once the slabs stop reading', () => {
    // At two pixels a slab the joints alias into grey haze that costs a thousand fill calls to
    // produce and looks worse than a flat colour.
    const smallest = Math.min(slab.moduleSize.w, slab.moduleSize.h);

    expect(tierFor(slab, zoomFor(smallest, MIN_DRAWN_MODULE_PX - 1))).toBe('mass');
    expect(tierFor(slab, zoomFor(smallest, MIN_DRAWN_MODULE_PX + 1))).not.toBe('mass');
  });

  it('lets aggregate go far smaller than paving before collapsing', () => {
    /*
     * The difference is deliberate, not an oversight. A gravel chipping genuinely is about a pixel
     * and a half at a normal editing zoom; raising its floor to the module floor made every
     * aggregate in the app fall back to flat colour and read as dead beige card.
     */
    expect(MIN_DRAWN_UNIT_PX).toBeLessThan(MIN_DRAWN_MODULE_PX);
    expect(tierFor(gravel, zoomFor(gravel.sizeRange.max, MIN_DRAWN_UNIT_PX + 0.5))).not.toBe(
      'mass',
    );
  });

  it('reaches the detail tier only when units are big enough to light', () => {
    const smallest = Math.min(slab.moduleSize.w, slab.moduleSize.h);

    expect(tierFor(slab, zoomFor(smallest, MIN_SHADED_PX - 1))).toBe('units');
    expect(tierFor(slab, zoomFor(smallest, MIN_SHADED_PX + 1))).toBe('detail');
  });

  it('never lights a stripe, because a mown band has no edge to catch the sun', () => {
    expect(tierFor(turf, 400)).toBe('units');
  });

  it('never collapses water, which is a body of colour before it is a texture', () => {
    expect(tierFor(pond, 1)).toBe('detail');
    expect(tierFor(pond, 400)).toBe('detail');
  });

  it('is total across every pattern in the catalogue, at every zoom the editor allows', () => {
    // MIN_SCALE and MAX_SCALE from the canvas viewport.
    for (const pxPerMetre of [4, 8, 32, 120, 400]) {
      expect(['mass', 'units', 'detail']).toContain(tierFor(slab, pxPerMetre));
      expect(['mass', 'units', 'detail']).toContain(tierFor(gravel, pxPerMetre));
      expect(['mass', 'units', 'detail']).toContain(tierFor(turf, pxPerMetre));
      expect(['mass', 'units', 'detail']).toContain(tierFor(pond, pxPerMetre));
    }
  });
});

describe('shadesAt', () => {
  it('refuses to light anything too small for a highlight to read', () => {
    // At three or four pixels a highlight and a shadow are a pixel each and read as dither.
    expect(shadesAt(MIN_SHADED_PX - 1)).toBe(false);
    expect(shadesAt(MIN_SHADED_PX)).toBe(true);
  });
});
