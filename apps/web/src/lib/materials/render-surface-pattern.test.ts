import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { MM_PER_METRE, type MaterialPattern, type Point } from '@garden-studio/schema';
import { resolvePattern, type MaterialManifestEntry } from './palette';
import { hexToRgb } from './light';
import { drawSurfacePattern, type PatternContext } from './render-surface-pattern';

/**
 * The renderer's tests run against a real 2D context from `@napi-rs/canvas`.
 *
 * jsdom returns `null` from `getContext('2d')`, and this repo deliberately never mounts a Konva
 * component in a unit test — drawn output is tested by pulling out the pure function and testing
 * that. `drawSurfacePattern` taking a context as its first argument is what makes that possible.
 *
 * Two fixtures, on purpose. `SHIPPED` is the real manifest, used wherever the assertion is about
 * determinism. `HIGH_CONTRAST` is a black-jointed, white-slabbed material with a deliberately fat
 * joint, used wherever the assertion is about *structure* — where the courses fall, how wide the
 * joint is, whether the grid stays anchored.
 *
 * That split is not a convenience. The shipped palette is a narrow spread of pale greys, and at a
 * realistic zoom a 10 mm joint on a 600 mm slab is well under one pixel — it never lands as a pure
 * colour, only as a slight darkening of its neighbours. A test that thresholded those pixels would
 * be measuring anti-aliasing, and would start failing the next time somebody tuned a hex.
 */

const SHIPPED = resolvePattern('stone-pavers');
if (!SHIPPED) throw new Error('stone-pavers must have a pattern manifest for these tests');

const shipped: MaterialManifestEntry = SHIPPED;

const HIGH_CONTRAST: MaterialManifestEntry = {
  ...shipped,
  pattern: {
    patternType: 'grid',
    moduleSize: { w: 600, h: 600 },
    /** 100 mm rather than 10: several pixels wide at a testable zoom, so it can be measured. */
    jointWidth: 100,
  },
  palette: ['#ffffff'],
  jointColour: '#000000',
};

const CONTRAST = HIGH_CONTRAST.pattern as Extract<MaterialPattern, { patternType: 'grid' }>;

/** Metres. Module 0.6 + joint 0.1. */
const CONTRAST_PITCH = (CONTRAST.moduleSize.w + CONTRAST.jointWidth) / MM_PER_METRE;

const ORIGIN: Point = { x: 0, y: 0 };

/** A 6 × 4 m rectangle with its top-left at (1, 1). */
const rectangle: Point[] = [
  { x: 1, y: 1 },
  { x: 7, y: 1 },
  { x: 7, y: 5 },
  { x: 1, y: 5 },
];

interface Rendered {
  buffer: Buffer;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface RenderOptions {
  seed?: string;
  rotation?: number;
  pxPerMetre?: number;
  origin?: Point;
  material?: MaterialManifestEntry;
  /** The world point the raster's own (0, 0) is, so surfaces can share one frame. */
  rasterOrigin?: Point;
  size?: { width: number; height: number };
}

/** Draws one or more surfaces into a single frame, at their true relative positions. */
function renderAll(
  surfaces: { outline: Point[]; seed?: string }[],
  options: RenderOptions = {},
): Rendered {
  const pxPerMetre = options.pxPerMetre ?? 40;
  const rasterOrigin = options.rasterOrigin ?? { x: 0, y: 0 };
  const width = options.size?.width ?? 400;
  const height = options.size?.height ?? 280;

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  for (const surface of surfaces) {
    drawSurfacePattern(
      context as unknown as PatternContext,
      surface.outline,
      options.material ?? shipped,
      options.origin ?? ORIGIN,
      options.rotation ?? 0,
      surface.seed ?? options.seed ?? 'surface-a',
      pxPerMetre,
      rasterOrigin,
    );
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    pixels: context.getImageData(0, 0, width, height).data,
    width,
    height,
  };
}

function render(outline: Point[], options: RenderOptions = {}): Rendered {
  return renderAll([{ outline }], options);
}

function pixelAt(rendered: Rendered, x: number, y: number): [number, number, number, number] {
  const index = (y * rendered.width + x) * 4;

  return [
    rendered.pixels[index]!,
    rendered.pixels[index + 1]!,
    rendered.pixels[index + 2]!,
    rendered.pixels[index + 3]!,
  ];
}

/** With the high-contrast fixture, a drawn pixel is either joint (dark) or module (light). */
function isJoint(rendered: Rendered, x: number, y: number): boolean {
  const [r, , , alpha] = pixelAt(rendered, x, y);
  return alpha > 0 && r < 128;
}

function isModule(rendered: Rendered, x: number, y: number): boolean {
  const [r, , , alpha] = pixelAt(rendered, x, y);
  return alpha > 0 && r >= 128;
}

describe('drawSurfacePattern', () => {
  it('is byte-identical for the same seed and inputs', () => {
    expect(render(rectangle).buffer.equals(render(rectangle).buffer)).toBe(true);
  });

  it('gives two surfaces different module tones', () => {
    // Same geometry, same grid, different id — the tones must not come out the same.
    const a = render(rectangle, { seed: 'surface-a' });
    const b = render(rectangle, { seed: 'surface-b' });

    expect(a.buffer.equals(b.buffer)).toBe(false);
  });

  it('draws a module count matching the area divided by the module pitch', () => {
    const pxPerMetre = 40;
    const rendered = render(rectangle, { material: HIGH_CONTRAST, pxPerMetre });

    // The grid is anchored at (0, 0), so a course centre sits a half-pitch off a grid line.
    const scanY = Math.round((2 * CONTRAST_PITCH + CONTRAST_PITCH / 2) * pxPerMetre);

    let runs = 0;
    let inModule = false;

    for (let x = 0; x < rendered.width; x += 1) {
      const onModule = isModule(rendered, x, scanY);
      if (onModule && !inModule) runs += 1;
      inModule = onModule;
    }

    // 6 m of paving on a 0.7 m pitch, give or take a part module clipped at each end.
    const expected = Math.ceil(6 / CONTRAST_PITCH);
    expect(runs).toBeGreaterThanOrEqual(expected - 1);
    expect(runs).toBeLessThanOrEqual(expected + 1);
  });

  it('keeps the joint the same real width as the zoom changes', () => {
    const jointMetres = CONTRAST.jointWidth / MM_PER_METRE;

    for (const pxPerMetre of [40, 120]) {
      const rendered = render(rectangle, {
        material: HIGH_CONTRAST,
        pxPerMetre,
        size: { width: Math.ceil(8 * pxPerMetre), height: Math.ceil(6 * pxPerMetre) },
      });

      const scanY = Math.round((2 * CONTRAST_PITCH + CONTRAST_PITCH / 2) * pxPerMetre);

      /*
       * Joints straddle the grid lines, which fall at whole multiples of the pitch. Measured by
       * walking out from the centre for as long as the pixels stay joint-coloured, rather than by
       * counting joint pixels in a fixed window — a window wide enough for the joint at one zoom
       * spans several whole modules at another, and quietly counts two joints as one fat one.
       */
      const jointCentre = Math.round(4 * CONTRAST_PITCH * pxPerMetre);
      expect(isJoint(rendered, jointCentre, scanY)).toBe(true);

      let jointPixels = 1;
      for (let x = jointCentre - 1; isJoint(rendered, x, scanY); x -= 1) jointPixels += 1;
      for (let x = jointCentre + 1; isJoint(rendered, x, scanY); x += 1) jointPixels += 1;

      // The point of the test: the joint is a real width, so its pixel width tracks the zoom.
      expect(jointPixels).toBeGreaterThanOrEqual(jointMetres * pxPerMetre - 1);
      expect(jointPixels).toBeLessThanOrEqual(jointMetres * pxPerMetre + 1);
    }
  });

  it('lines two surfaces up across a shared edge', () => {
    /*
     * Acceptance criterion 3, and the strongest test here.
     *
     * Two patios butted along x = 5, drawn into one frame with the same seed, must produce exactly
     * what one 8 m patio produces — every course in the same place, every slab the same tone. That
     * is only true if the grid is generated from the plan origin rather than from each surface's
     * own corner, which is the property the whole world-space design exists for.
     *
     * Same seed deliberately: with different seeds the tones would differ by design, and the test
     * would be reduced to hunting for joint positions again.
     */
    const seed = 'shared';
    const pxPerMetre = 40;
    const size = { width: 400, height: 240 };

    const whole = render(
      [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 5 },
        { x: 1, y: 5 },
      ],
      { seed, pxPerMetre, size },
    );

    const halves = renderAll(
      [
        {
          outline: [
            { x: 1, y: 1 },
            { x: 5, y: 1 },
            { x: 5, y: 5 },
            { x: 1, y: 5 },
          ],
        },
        {
          outline: [
            { x: 5, y: 1 },
            { x: 9, y: 1 },
            { x: 9, y: 5 },
            { x: 5, y: 5 },
          ],
        },
      ],
      { seed, pxPerMetre, size },
    );

    const seamPx = 5 * pxPerMetre;
    let compared = 0;

    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        // The clip edge itself is anti-aliased twice in the two-surface case; skip that one column.
        if (Math.abs(x - seamPx) <= 1) continue;

        expect(pixelAt(halves, x, y)).toEqual(pixelAt(whole, x, y));
        compared += 1;
      }
    }

    expect(compared).toBeGreaterThan(0);
  });

  it('turns the courses without re-anchoring the grid', () => {
    expect(render(rectangle, { rotation: 0 }).buffer).not.toEqual(
      render(rectangle, { rotation: 30 }).buffer,
    );

    /*
     * The anchor does not move with the rotation: a module corner still lands on the pattern
     * origin, so rotating turns the courses rather than sliding them. Checked at three angles at a
     * zoom where the joint is comfortably wider than a pixel.
     */
    const pxPerMetre = 120;
    const around: Point[] = [
      { x: -1, y: -1 },
      { x: 2, y: -1 },
      { x: 2, y: 2 },
      { x: -1, y: 2 },
    ];

    for (const rotation of [0, 30, 45]) {
      const rendered = render(around, {
        material: HIGH_CONTRAST,
        rotation,
        pxPerMetre,
        rasterOrigin: { x: -1, y: -1 },
        size: { width: 3 * pxPerMetre, height: 3 * pxPerMetre },
      });

      // World (0, 0) is one metre in from the raster corner, and is where four modules meet.
      expect(isJoint(rendered, pxPerMetre, pxPerMetre)).toBe(true);
    }
  });

  it('re-anchors when the origin moves', () => {
    const anchored = render(rectangle, { material: HIGH_CONTRAST });
    const shifted = render(rectangle, {
      material: HIGH_CONTRAST,
      origin: { x: 0.3, y: 0.15 },
    });

    expect(anchored.buffer.equals(shifted.buffer)).toBe(false);
  });

  it('leaves the rest of a surface unchanged when its outline is re-clipped', () => {
    /*
     * Acceptance criterion 5. Dragging one vertex must re-clip the pattern without reshuffling the
     * tones elsewhere — which holds because a module's tone is seeded from its grid coordinates
     * rather than from its position in the render sweep. Seed it from the sweep instead and this
     * test goes red immediately, which is the point of having it.
     */
    const moved: Point[] = [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 6, y: 5 },
      { x: 1, y: 5 },
    ];

    const before = render(rectangle);
    const after = render(moved);

    // A patch well inside both outlines, away from the vertex that moved.
    let compared = 0;

    for (let y = 60; y < 140; y += 1) {
      for (let x = 60; x < 180; x += 1) {
        expect(pixelAt(after, x, y)).toEqual(pixelAt(before, x, y));
        compared += 1;
      }
    }

    expect(compared).toBeGreaterThan(0);
  });

  it('falls back to one flat tone when a module is too small to read', () => {
    // 4 px per metre is the editor's MIN_SCALE: a 600 mm slab is 2.4 px, below the drawn threshold.
    const rendered = render(rectangle, { pxPerMetre: 4, size: { width: 40, height: 28 } });

    expect(pixelAt(rendered, 16, 12)).toEqual(pixelAt(rendered, 20, 14));
  });

  it('clips to the outline and draws nothing outside it', () => {
    const rendered = render(rectangle, { material: HIGH_CONTRAST });

    // Inside, at the centre of the rectangle.
    expect(pixelAt(rendered, 160, 120)[3]).toBeGreaterThan(0);
    // Outside, beyond every edge.
    expect(pixelAt(rendered, 10, 10)[3]).toBe(0);
    expect(pixelAt(rendered, 320, 120)[3]).toBe(0);
    expect(pixelAt(rendered, 160, 240)[3]).toBe(0);
  });

  it('draws nothing for a degenerate outline', () => {
    const line: Point[] = [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
    ];

    expect(render(line).pixels.every((channel) => channel === 0)).toBe(true);
  });
});

describe('the other pattern types', () => {
  /**
   * Every pattern must keep the properties `grid` was built to have. These are the ones that stop
   * the plan shimmering when the user pans, and they are easy to lose in a new case — a scatter
   * seeded from its iteration order rather than its cell would pass a "does it draw" test and fail
   * every one of these.
   */
  const each = [
    { id: 'mixed-border', label: 'scatter' },
    { id: 'standard-turf', label: 'stripe' },
    { id: 'timber-decking', label: 'board' },
  ] as const;

  for (const { id, label } of each) {
    const material = resolvePattern(id);
    if (!material) throw new Error(`${id} must have a pattern manifest`);

    describe(label, () => {
      it('is byte-identical for the same seed and inputs', () => {
        const first = render(rectangle, { material });
        const second = render(rectangle, { material });

        expect(first.buffer.equals(second.buffer)).toBe(true);
      });

      it('differs between two surfaces', () => {
        const a = render(rectangle, { material, seed: 'surface-a' });
        const b = render(rectangle, { material, seed: 'surface-b' });

        expect(a.buffer.equals(b.buffer)).toBe(false);
      });

      it('lines up across a shared edge', () => {
        const seed = 'shared';
        const size = { width: 400, height: 240 };
        const pxPerMetre = 40;

        const whole = render(
          [
            { x: 1, y: 1 },
            { x: 9, y: 1 },
            { x: 9, y: 5 },
            { x: 1, y: 5 },
          ],
          { material, seed, pxPerMetre, size },
        );

        const halves = renderAll(
          [
            {
              outline: [
                { x: 1, y: 1 },
                { x: 5, y: 1 },
                { x: 5, y: 5 },
                { x: 1, y: 5 },
              ],
            },
            {
              outline: [
                { x: 5, y: 1 },
                { x: 9, y: 1 },
                { x: 9, y: 5 },
                { x: 5, y: 5 },
              ],
            },
          ],
          { material, seed, pxPerMetre, size },
        );

        /*
         * Scatter is the case most likely to break this: a unit whose centre sits left of the seam
         * can still spill over it, and the right-hand surface clips that spill away. So the seam
         * band excluded here is a unit wide, not the single anti-aliased column `grid` needs.
         */
        const seamPx = 5 * pxPerMetre;
        const tolerance = label === 'scatter' ? 1.3 * pxPerMetre : 1;
        let compared = 0;

        for (let y = 0; y < size.height; y += 1) {
          for (let x = 0; x < size.width; x += 1) {
            if (Math.abs(x - seamPx) <= tolerance) continue;

            expect(pixelAt(halves, x, y)).toEqual(pixelAt(whole, x, y));
            compared += 1;
          }
        }

        expect(compared).toBeGreaterThan(0);
      });

      it('leaves the rest of a surface unchanged when its outline is re-clipped', () => {
        const moved: Point[] = [
          { x: 1, y: 1 },
          { x: 7, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ];

        const before = render(rectangle, { material });
        const after = render(moved, { material });

        /*
         * Within a channel step, not byte-identical, and only for the curved patterns.
         *
         * A unit's tone is a pure function of its cell, so nothing reshuffles — that is the
         * property under test and it holds exactly. But a blob is a path with anti-aliased edges,
         * and the rasteriser's coverage arithmetic is not bit-stable against a change in the clip
         * region even for pixels far inside it. Demanding equal bytes here would be testing
         * @napi-rs/canvas, not this renderer. `grid` fills axis-aligned rectangles and has no such
         * edges, which is why its version of this test does demand equality.
         */
        const tolerance = label === 'stripe' ? 0 : 2;

        for (let y = 60; y < 140; y += 1) {
          for (let x = 60; x < 150; x += 1) {
            const now = pixelAt(after, x, y);
            const then = pixelAt(before, x, y);

            for (let channel = 0; channel < 4; channel += 1) {
              expect(Math.abs(now[channel]! - then[channel]!)).toBeLessThanOrEqual(tolerance);
            }
          }
        }
      });

      it('falls back to a flat tone when its units are too small to read', () => {
        // A big plot at a very low zoom, so every pattern is under its own level-of-detail floor.
        const wide: Point[] = [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 40 },
          { x: 0, y: 40 },
        ];

        const rendered = render(wide, {
          material,
          pxPerMetre: 1,
          size: { width: 60, height: 40 },
        });

        expect(pixelAt(rendered, 20, 15)).toEqual(pixelAt(rendered, 38, 27));
      });
    });
  }

  it('covers a planted bed rather than leaving its soil bare', () => {
    /*
     * The failure the first tuning pass actually had: beds drawn at a real planting density read
     * as scattered dots on mud, because a plan shows one instant where a garden is judged by how
     * it will look once grown. Scatter only — a stripe's ground *is* one of its two tones, and a
     * grid's joint is meant to show.
     */
    for (const id of ['mixed-border', 'shrubs', 'ground-cover', 'hedging'] as const) {
      const material = resolvePattern(id);
      if (!material) throw new Error(`${id} must have a pattern manifest`);

      const rendered = render(rectangle, { material, pxPerMetre: 40 });
      const soil = hexToRgb(material.jointColour);

      let drawn = 0;
      let bare = 0;

      for (let y = 60; y < 180; y += 2) {
        for (let x = 60; x < 260; x += 2) {
          const [r, g, b, alpha] = pixelAt(rendered, x, y);
          if (alpha === 0) continue;

          drawn += 1;
          const isSoil =
            Math.abs(r - soil.r) < 6 && Math.abs(g - soil.g) < 6 && Math.abs(b - soil.b) < 6;
          if (isSoil) bare += 1;
        }
      }

      expect(drawn).toBeGreaterThan(0);
      expect(bare / drawn, `${id} shows too much bare ground`).toBeLessThan(0.35);
    }
  });

  it('staggers board rows, so butt joints do not line up', () => {
    const decking = resolvePattern('timber-decking');
    if (!decking) throw new Error('timber-decking must have a pattern manifest');

    const pattern = decking.pattern as Extract<MaterialPattern, { patternType: 'board' }>;
    const pxPerMetre = 60;

    const rendered = render(rectangle, { material: decking, pxPerMetre });

    /*
     * A butt joint falls on a multiple of the board length in even rows and half a board off it in
     * odd ones. Sampling the same x in two adjacent rows must therefore find the joint in one and
     * a board in the other — which is the whole difference between decking and very long tiles.
     */
    const joint = pattern.jointWidth / MM_PER_METRE;
    const pitchX = pattern.moduleSize.w / MM_PER_METRE + joint;
    const pitchY = pattern.moduleSize.h / MM_PER_METRE + joint;

    // The grid line between column 0 and column 1, where an even row has its butt joint.
    const jointX = Math.round(pitchX * pxPerMetre);
    // Rows well inside the shape, which spans y = 1 to 5 m.
    const rowY = (row: number) => Math.round((row * pitchY + pitchY / 2) * pxPerMetre);

    const even = pixelAt(rendered, jointX, rowY(14));
    const odd = pixelAt(rendered, jointX, rowY(15));

    expect(even[3]).toBeGreaterThan(0);
    expect(odd[3]).toBeGreaterThan(0);
    // One row shows the gap between two boards; the staggered one shows the middle of a board.
    expect(even).not.toEqual(odd);
  });
});
