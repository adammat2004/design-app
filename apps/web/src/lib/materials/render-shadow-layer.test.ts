import { describe, expect, it } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { Point, ShadowCast } from '@garden-studio/schema';
import { SHADOW_TONE } from './light';
import { drawShadowLayer, renderShadowLayer, type ShadowOccluder } from './render-shadow-layer';
import type { MakeCanvas, PatternCanvas, PatternContext } from './render-surface-pattern';

/** Sun due south at 45 degrees: shadows fall due north, one metre per metre of height. */
const NORTHWARD: ShadowCast = { direction: { x: 0, y: -1 }, lengthPerMetre: 1 };

const PX_PER_METRE = 10;

/** A 20 x 20 m plot with its corner on the origin, so metres map to pixels by a factor of ten. */
const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

function square(x: number, y: number, size: number): Point[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

interface Drawn {
  at(xMetres: number, yMetres: number): [number, number, number, number];
  bytes: Buffer;
}

function draw(occluders: ShadowOccluder[], boundary: Point[] = PLOT): Drawn {
  const canvas = createCanvas(20 * PX_PER_METRE, 20 * PX_PER_METRE);
  const context = canvas.getContext('2d');

  drawShadowLayer(
    context as unknown as PatternContext,
    occluders,
    NORTHWARD,
    boundary,
    { pxPerMetre: PX_PER_METRE },
    { x: 0, y: 0 },
  );

  return {
    at(xMetres, yMetres) {
      const { data } = context.getImageData(xMetres * PX_PER_METRE, yMetres * PX_PER_METRE, 1, 1);
      return [data[0]!, data[1]!, data[2]!, data[3]!];
    },
    bytes: canvas.toBuffer('image/png'),
  };
}

describe('drawShadowLayer', () => {
  /**
   * The assertion the whole design exists for, in its general form:
   *
   *     **where two shadows overlap, the result is the darker of them — never their sum.**
   *
   * That used to be written as "the overlap equals either one", which was the same statement while
   * every shadow was the same darkness. It stopped being once foliage got a lighter tone than
   * masonry, and the honest generalisation is the one above: a porous canopy in front of a wall
   * cannot un-block the sun, so the wall's shade wins there. The half that has not changed, and
   * must not, is that nothing anywhere *adds* — two shadows on one patch are one shadow.
   *
   * This case holds the original equality, because both occluders are the same character. The
   * cross-character case is `foliage against built` below.
   */
  it('does not double-darken where two shadows of one character overlap', () => {
    // Both 2 m squares, 4 m tall, stacked so their northward shadows share a 2 m band.
    // A shades y 6..12, B shades y 2..8, so 6..8 is covered by both.
    const drawn = draw([
      { outline: square(5, 10, 2), height: 4 },
      { outline: square(5, 6, 2), height: 4 },
    ]);

    const onlyA = drawn.at(6, 10.5);
    const onlyB = drawn.at(6, 4);
    const both = drawn.at(6, 7);

    expect(both).toEqual(onlyA);
    expect(both).toEqual(onlyB);
    // And it really is drawn, rather than all three being empty.
    expect(both[3]).toBe(255);
  });

  /*
   * The generalised invariant, on the case that made it necessary.
   *
   * A tree standing in front of a wall: the canopy's shade is lighter, the wall's is darker, and
   * where they cross the answer is the wall's. Checked by luminance rather than by equality with a
   * named constant, so it keeps meaning the right thing if either tone is ever retuned.
   */
  it('resolves a foliage and a built shadow to the darker of the two, never their sum', () => {
    /*
     * Through `renderShadowLayer`, not `draw`: bucketing by character is what that function does,
     * and `drawShadowLayer` is one bucket by construction — it takes a single tone for the whole
     * call, which is exactly the property that stops an occluder darkening its neighbour.
     *
     * A shadow runs from its occluder's near edge to `height` metres past it, so with 3 m squares
     * 8 m tall the foliage covers y 4..15 and the wall covers y -4..7. Sample points sit at least
     * 15 px from every edge, which is well clear of the 4.5 px foliage blur.
     */
    const pass = { pxPerMetre: PX_PER_METRE, makeCanvas, softnessMetres: 0.06 };
    const canopy: ShadowOccluder = { outline: square(4, 12, 3), height: 8, character: 'foliage' };
    const wall: ShadowOccluder = { outline: square(4, 4, 3), height: 8, character: 'built' };

    const raster = renderShadowLayer([canopy, wall], NORTHWARD, PLOT, pass)!;
    // The real thing, not the narrowed `PatternContext`: reading pixels back is a test's job.
    const context = (raster.canvas as unknown as Canvas).getContext('2d');
    const luma = (xMetres: number, yMetres: number) => {
      const { data } = context.getImageData(
        xMetres * raster.pxPerMetre,
        yMetres * raster.pxPerMetre,
        1,
        1,
      );

      return 0.2126 * data[0]! + 0.7152 * data[1]! + 0.0722 * data[2]!;
    };

    const onlyFoliage = luma(5.5, 11);
    const onlyBuilt = luma(5.5, 2);
    const both = luma(5.5, 5.5);

    // Foliage really is the lighter of the two, or the rest of this proves nothing.
    expect(onlyFoliage).toBeGreaterThan(onlyBuilt + 5);

    // The overlap is the darker one — not darker still, which is what summing would give.
    expect(both).toBeCloseTo(onlyBuilt, 0);
    expect(both).toBeLessThan(onlyFoliage);
  });

  /* Order of arrival must not decide the overlap: the bucket order does, and it is fixed. */
  it('gives the same answer whichever order the two characters arrive in', () => {
    const canopy: ShadowOccluder = {
      outline: square(5, 10, 2),
      height: 4,
      character: 'foliage',
    };
    const wall: ShadowOccluder = { outline: square(5, 6, 2), height: 4, character: 'built' };

    const pass = { pxPerMetre: PX_PER_METRE, makeCanvas, softnessMetres: 0.06 };
    const a = renderShadowLayer([canopy, wall], NORTHWARD, PLOT, pass)!;
    const b = renderShadowLayer([wall, canopy], NORTHWARD, PLOT, pass)!;

    const png = (raster: { canvas: unknown }) =>
      (raster.canvas as Canvas).toBuffer('image/png');

    expect(png(a).equals(png(b))).toBe(true);
  });

  /*
   * An occluder with no character is a built one. Every caller that existed before buckets did
   * passes none, so this is what keeps the plan view and every stored expectation unchanged.
   */
  it('treats an occluder with no stated character as built', () => {
    const stated = draw([{ outline: square(5, 10, 2), height: 4, character: 'built' }]);
    const silent = draw([{ outline: square(5, 10, 2), height: 4 }]);

    expect(stated.at(6, 8)).toEqual(silent.at(6, 8));
  });

  it('draws the shadow opaque, so the layer can be composited once', () => {
    const drawn = draw([{ outline: square(5, 10, 2), height: 4 }]);
    const [r, g, b, a] = drawn.at(6, 8);

    const expected = SHADOW_TONE.replace('#', '')
      .match(/.{2}/g)!
      .map((h) => parseInt(h, 16));

    expect([r, g, b]).toEqual(expected);
    expect(a).toBe(255);
  });

  it('puts the shadow on the far side of the occluder from the sun', () => {
    // The sun is south, so the shadow is north of the object — smaller y. If this ever inverts,
    // the plan looks subtly wrong everywhere rather than obviously broken anywhere.
    const drawn = draw([{ outline: square(5, 10, 2), height: 4 }]);

    expect(drawn.at(6, 8)[3]).toBe(255); // north of it: shaded
    expect(drawn.at(6, 15)[3]).toBe(0); // south of it: lit
  });

  it('clips the shadow to the plot rather than shading the neighbours', () => {
    // A triangular plot, so there is somewhere inside the bounding box but outside the boundary.
    const triangle: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ];
    const eastward: ShadowCast = { direction: { x: 1, y: 0 }, lengthPerMetre: 2 };

    const canvas = createCanvas(20 * PX_PER_METRE, 20 * PX_PER_METRE);
    const context = canvas.getContext('2d');

    drawShadowLayer(
      context as unknown as PatternContext,
      [{ outline: square(4, 10, 2), height: 4 }],
      eastward,
      triangle,
      { pxPerMetre: PX_PER_METRE },
      { x: 0, y: 0 },
    );

    const pixel = (x: number, y: number) =>
      context.getImageData(x * PX_PER_METRE, y * PX_PER_METRE, 1, 1).data[3];

    // Shadow runs from x=4 to x=14 at y 10..12. Inside the triangle it lands...
    expect(pixel(8, 11)).toBe(255);
    // ...and past the hypotenuse (x + y > 20) it is cut off rather than spilling next door.
    expect(pixel(13, 11)).toBe(0);
  });

  it('skips anything too short to cast, without disturbing the rest', () => {
    const drawn = draw([
      { outline: square(5, 10, 2), height: 0 },
      { outline: square(12, 10, 2), height: 4 },
    ]);

    expect(drawn.at(6, 8)[3]).toBe(0); // the flat one casts nothing
    expect(drawn.at(13, 8)[3]).toBe(255); // its neighbour still does
  });

  it('is deterministic, because the layer is compared byte for byte', () => {
    const occluders = [
      { outline: square(5, 10, 2), height: 4 },
      { outline: square(9, 12, 3), height: 2.5 },
    ];

    expect(draw(occluders).bytes.equals(draw(occluders).bytes)).toBe(true);
  });

  it('does not depend on the order occluders arrive in', () => {
    // They are all one colour and all opaque, so the union cannot care about order. If this ever
    // fails, something has started drawing translucently.
    const a = { outline: square(5, 10, 2), height: 4 };
    const b = { outline: square(5, 6, 2), height: 4 };

    expect(draw([a, b]).bytes.equals(draw([b, a]).bytes)).toBe(true);
  });
});

describe('renderShadowLayer', () => {
  it('softens the merged presentation shadow without double-darkening or leaking outside the plot', () => {
    const occluder = { outline: square(5, 10, 2), height: 4 };
    const pass = { pxPerMetre: 50, makeCanvas, softnessMetres: 0.06 };
    const single = renderShadowLayer([occluder], NORTHWARD, PLOT, pass)!;
    const duplicate = renderShadowLayer([occluder, occluder], NORTHWARD, PLOT, pass)!;
    const pixels = (raster: typeof single) =>
      (raster.canvas as unknown as ReturnType<typeof createCanvas>).getContext('2d');
    expect(pixels(single).getImageData(0, 0, 1000, 1000).data).toEqual(
      pixels(duplicate).getImageData(0, 0, 1000, 1000).data,
    );
    const edgeAlpha = pixels(single).getImageData(249, 400, 1, 1).data[3]!;
    expect(edgeAlpha).toBeGreaterThan(0);
    expect(edgeAlpha).toBeLessThan(255);
    expect(pixels(single).getImageData(300, 400, 1, 1).data[3]).toBe(255);
    const triangle = [PLOT[0]!, PLOT[1]!, PLOT[3]!];
    const clipped = renderShadowLayer([{ outline: square(9, 11, 2), height: 4 }],
      NORTHWARD, triangle, pass)!;
    expect(pixels(clipped).getImageData(550, 550, 1, 1).data[3]).toBe(0);
  });

  it('is null when there is nothing to cast a shadow', () => {
    expect(renderShadowLayer([], NORTHWARD, PLOT, { pxPerMetre: 10, makeCanvas })).toBeNull();
  });

  it('is null when the plot is not a polygon', () => {
    const occluders = [{ outline: square(5, 10, 2), height: 4 }];

    expect(
      renderShadowLayer(occluders, NORTHWARD, [{ x: 0, y: 0 }], { pxPerMetre: 10, makeCanvas }),
    ).toBeNull();
  });

  it('covers the plot, not the shadows, so the origin holds still as the sun moves', () => {
    // Anchoring to the union of the shadows would move the raster's corner every time the time
    // of day changed, shifting every pixel of the layer sideways as its extent grew and shrank.
    const occluders = [{ outline: square(5, 10, 2), height: 4 }];

    const noon = renderShadowLayer(occluders, NORTHWARD, PLOT, { pxPerMetre: 10, makeCanvas })!;
    const evening = renderShadowLayer(
      occluders,
      { direction: { x: -1, y: 0 }, lengthPerMetre: 6 },
      PLOT,
      { pxPerMetre: 10, makeCanvas },
    )!;

    expect(noon.originMetres).toEqual({ x: 0, y: 0 });
    expect(evening.originMetres).toEqual(noon.originMetres);
    expect(evening.widthPx).toBe(noon.widthPx);
  });
});
