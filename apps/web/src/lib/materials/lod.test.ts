import { describe, expect, it } from 'vitest';
import { materialPattern, MM_PER_METRE, type MaterialPattern } from '@garden-studio/schema';
import { MIN_DRAWN_MODULE_PX, MIN_DRAWN_UNIT_PX, MIN_SHADED_PX, shadesAt, tierFor } from './lod';

/*
 * `concrete` rather than `stone-pavers`: the latter is a mixed pack now, and these tests are about
 * the module floors, which need a pattern with one module. The pack has its own case below.
 */
const slab = materialPattern('concrete')! as Extract<MaterialPattern, { patternType: 'grid' }>;
const pack = materialPattern('stone-pavers')! as Extract<MaterialPattern, { patternType: 'pack' }>;
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

  it('judges a pack on its mean course, not on its smallest member', () => {
    /*
     * A pack mixes sizes on purpose, so `Math.min` would let the one short course in it drag a
     * whole terrace to a flat tone. The tier says what is worth *attempting* for the surface, and a
     * coursed pack's grain is its coursing.
     */
    const mean = pack.courses.reduce((total, course) => total + course, 0) / pack.courses.length;
    const smallest = Math.min(...pack.courses);
    expect(smallest).toBeLessThan(mean);

    expect(tierFor(pack, zoomFor(mean, MIN_SHADED_PX + 1))).toBe('detail');
    expect(tierFor(pack, zoomFor(mean, MIN_SHADED_PX - 1))).toBe('units');
    expect(tierFor(pack, zoomFor(mean, MIN_DRAWN_MODULE_PX - 1))).toBe('mass');
    // The zoom that would flatten it if the smallest member decided still gives detail.
    expect(tierFor(pack, zoomFor(smallest, MIN_SHADED_PX + 1))).toBe('detail');
  });

  it('keeps paving lit at the zoom a whole plan is read at', () => {
    /*
     * The reason `MIN_SHADED_PX` came down from twelve. At 26 px/m a 400 mm slab is 10.4 px: under
     * the old floor every terrace on every concept card lost its lit edge and read flat.
     */
    const PLAN_ZOOM = 26;
    expect(tierFor(slab, PLAN_ZOOM)).toBe('detail');
    expect(tierFor(pack, PLAN_ZOOM)).toBe('detail');
    // A sett is small enough to stay flat there, which is right: no chamfer reads at that distance.
    const sett = materialPattern('stone-setts')!;
    expect(tierFor(sett, PLAN_ZOOM)).toBe('units');
    expect(tierFor(sett, 64)).toBe('detail');
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
