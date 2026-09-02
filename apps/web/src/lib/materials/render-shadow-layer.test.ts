import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
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
   * The assertion the whole design exists for.
   *
   * Two overlapping shadows are one shadow — standing a tree in a hedge's shade does not make
   * that patch twice as dark. Drawing translucent shapes in sequence would double-darken it, and
   * that reads instantly as a rendering bug. Filling opaque into a dedicated layer and
   * compositing once is what makes the overlap merge, with no polygon-union library involved.
   */
  it('does not double-darken where two shadows overlap', () => {
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
