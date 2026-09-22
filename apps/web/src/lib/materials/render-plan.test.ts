import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  DesignElementSchema,
  rectangleHouse,
  SiteSectionSchema,
  type DesignElement,
  type Opening,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import type { BuildOptions } from '../render/build-scene';
import { drawPlan, firstFeatureIndex, type PlanContext, type PlanScene } from './render-plan';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

/**
 * The composer is tested the way the surface painter is: against a real 2D context from
 * `@napi-rs/canvas`, sampling pixels only where the assertion is structural and never thresholding
 * the shipped palette's tones.
 */

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

const PX = 20;

const plot: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 14 },
  { x: 0, y: 14 },
];

const house = rectangleHouse({ x: 10, y: 3 }, 8, 4);

function element(over: Record<string, unknown>): DesignElement {
  return DesignElementSchema.parse({
    category: 'lawn',
    role: 'fill',
    zone: 'back',
    ...over,
  });
}

const lawn = element({
  id: 'lawn',
  material: 'standard-turf',
  fillKind: 'base',
  shape: { kind: 'rect', centre: { x: 10, y: 9.5 }, width: 20, depth: 9, rotation: 0 },
});

const patio = element({
  id: 'patio',
  category: 'paved-area',
  role: 'feature',
  name: 'Patio',
  material: 'stone-pavers',
  shape: { kind: 'rect', centre: { x: 6, y: 8 }, width: 5, depth: 3.5, rotation: 0 },
});

const tree = element({
  id: 'tree',
  category: 'planting-bed',
  role: 'feature',
  name: 'Tree',
  material: 'shrubs',
  shape: { kind: 'point', at: { x: 15, y: 10 }, radius: 1.6 },
  height: 5,
});

const path = element({
  id: 'path',
  category: 'paved-area',
  role: 'feature',
  name: 'Path',
  material: 'stepping-stones',
  shape: {
    kind: 'polyline',
    points: [
      { x: 10, y: 5 },
      { x: 10, y: 12 },
    ],
    width: 1,
  },
});

function site(over: Partial<SiteSection> = {}): SiteSection {
  return SiteSectionSchema.parse({
    vertices: plot.map((point, index) => ({ ...point, id: `v${index}` })),
    closed: true,
    house,
    ...over,
  });
}

function scene(elements: DesignElement[], over: Partial<SiteSection> = {}): PlanScene {
  return { boundary: plot, house, elements, site: site(over) };
}

function render(
  input: PlanScene,
  pxPerMetre = PX,
  options: BuildOptions = {},
): { pixels: Uint8ClampedArray; width: number } {
  const width = 20 * pxPerMetre;
  const height = 14 * pxPerMetre;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  drawPlan(
    context as unknown as PlanContext,
    input,
    { pxPerMetre, makeCanvas },
    { x: 0, y: 0 },
    options,
  );

  return { pixels: context.getImageData(0, 0, width, height).data, width };
}

function at(image: { pixels: Uint8ClampedArray; width: number }, x: number, y: number) {
  const index = (Math.round(y * PX) * image.width + Math.round(x * PX)) * 4;
  return Array.from(image.pixels.slice(index, index + 4));
}

describe('drawPlan', () => {
  it('is deterministic', () => {
    const a = render(scene([lawn, patio, tree, path]));
    const b = render(scene([lawn, patio, tree, path]));

    expect(Buffer.from(a.pixels)).toEqual(Buffer.from(b.pixels));
  });

  it('draws features over fills', () => {
    const image = render(scene([lawn, patio]));

    // The patio's centre is paving, not lawn; the lawn far from it is lawn.
    const insidePatio = at(image, 6, 8);
    const onLawn = at(image, 17, 12);
    expect(insidePatio).not.toEqual(onLawn);

    // And the lawn there is what a lawn on its own draws — the patio changed nothing outside itself.
    const alone = render(scene([lawn]));
    expect(at(alone, 17, 12)).toEqual(onLawn);
  });

  it('draws nothing for a hidden element', () => {
    const shown = render(scene([lawn, { ...patio, hidden: true }]));
    const absent = render(scene([lawn]));

    expect(Buffer.from(shown.pixels)).toEqual(Buffer.from(absent.pixels));
  });

  it('draws the house above the surfaces', () => {
    const withLawn = render(scene([lawn]));
    const houseOnly = render(scene([]));

    // The house centre is house in both; a bed under it changes nothing.
    expect(at(withLawn, 10, 3)).toEqual(at(houseOnly, 10, 3));
  });

  /**
   * The composer drew no openings at all until Phase 3, so a patio door was visible on step 1 and
   * absent from every thumbnail, export and judging sheet of the same plan — the door being the
   * single most layout-determining object in the drawing, and the sheets being what it is judged
   * on. These pin that it draws them, and that a plan with none is byte-identical to before.
   */
  describe('openings', () => {
    /** The house is 8 x 4 centred at (10, 3), so wall w0 runs along its top from x 6 to x 14. */
    const door: Opening = {
      id: 'o1',
      wallId: 'w0',
      offsetAlongEdge: 4,
      width: 2.4,
      type: 'patio-door' as const,
      sillHeight: 0,
      floorLevel: 0,
      swing: 'none' as const,
    };

    /*
     * The house has to be replaced on the *scene* as well as on the site: `buildRenderScene`
     * resolves the building from `PlanScene.house`, and overriding only the site left every one
     * of these comparing a plan with no openings against itself.
     */
    const withOpenings = (openings: Opening[]): PlanScene => {
      const withDoors = { ...house, openings };
      return {
        boundary: plot,
        house: withDoors,
        elements: [lawn],
        site: site({ house: withDoors }),
      };
    };

    it('cuts a door into the wall band', () => {
      const shut = render(withOpenings([]));
      const open = render(withOpenings([door]));

      expect(Buffer.from(open.pixels)).not.toEqual(Buffer.from(shut.pixels));
    });

    it('leaves a plan with no openings exactly as it was', () => {
      const bare = render(withOpenings([]));
      const same = render(scene([lawn]));

      expect(Buffer.from(bare.pixels)).toEqual(Buffer.from(same.pixels));
    });

    /*
     * A window is not a hole you walk through, so it is not drawn as one — the wall carries on
     * past it. Drawn as a gap, every window read as a doorway.
     */
    it('draws a window differently from a door in the same place', () => {
      const asDoor = render(withOpenings([door]));
      const asWindow = render(
        withOpenings([{ ...door, type: 'window' as const, sillHeight: 0.9 }]),
      );

      expect(Buffer.from(asWindow.pixels)).not.toEqual(Buffer.from(asDoor.pixels));
    });

    it('draws a hinged door’s swing, and a sliding one without', () => {
      const sliding = render(withOpenings([door]));
      const hinged = render(withOpenings([{ ...door, swing: 'outward' as const }]));

      expect(Buffer.from(hinged.pixels)).not.toEqual(Buffer.from(sliding.pixels));
    });

    /*
     * The rule `openings.ts` sets and the canvas already followed: an opening whose wall no longer
     * holds it is left out rather than drawn hanging off the end of the building.
     */
    it('draws nothing for an opening that no longer fits its wall', () => {
      const overrunning = render(withOpenings([{ ...door, offsetAlongEdge: 40 }]));
      const none = render(withOpenings([]));

      expect(Buffer.from(overrunning.pixels)).toEqual(Buffer.from(none.pixels));
    });
  });

  /**
   * Where the shade falls is the sun's business; that there *is* shade is the drawing's.
   *
   * _This reverses_ "casts shadows only when the plan knows where it is". A plan with no location
   * now casts the same conventional shadow it already drew as a contact disc under every sprite
   * and a shade band along every fence — what it still refuses to do is claim that this is where
   * the shade falls at ten in the morning, which is what the located case below asserts by putting
   * the shadow somewhere the convention would never put it.
   */
  it('casts the drawing’s own shadows with no location, and the sun’s once it has one', () => {
    const unlit = render(scene([lawn, tree]), PX, { shadows: false });
    const conventional = render(scene([lawn, tree]));
    const lit = render(
      scene([lawn, tree], {
        location: { latitude: 53.4, longitude: -2.98 },
        sun: { dayOfYear: 172, minutes: 600 },
      }),
    );

    const luminance = (rgba: number[]) => rgba[0]! + rgba[1]! + rgba[2]!;

    // A patch of lawn nowhere near anything tall is untouched however the picture is lit.
    expect(at(lit, 2, 12)).toEqual(at(unlit, 2, 12));
    expect(at(conventional, 2, 12)).toEqual(at(unlit, 2, 12));

    /*
     * Both throw a shadow; they throw it in opposite directions, which is the whole point. The
     * conventional light comes from the upper left so its shade falls to the lower right; the real
     * morning sun throws it north-west, up and left on screen. So each is darker than no shadow at
     * all on its own side, and *lighter* than the other one there. Compared rather than pinned to
     * a pixel, because a soft edge reaches a little way into both.
     */
    const lowerRight = [15.4, 11.4] as const;
    const upperLeft = [13.5, 8.8] as const;

    expect(luminance(at(conventional, ...lowerRight))).toBeLessThan(luminance(at(unlit, ...lowerRight)));
    expect(luminance(at(conventional, ...lowerRight))).toBeLessThan(luminance(at(lit, ...lowerRight)));

    expect(luminance(at(lit, ...upperLeft))).toBeLessThan(luminance(at(unlit, ...upperLeft)));
    expect(luminance(at(lit, ...upperLeft))).toBeLessThan(luminance(at(conventional, ...upperLeft)));
  });

  it('draws point and polyline symbols without throwing', () => {
    const firePit = element({
      id: 'fire',
      category: 'gravel-mulch',
      role: 'feature',
      name: 'Fire pit',
      material: 'play-bark',
      shape: { kind: 'point', at: { x: 4, y: 12 }, radius: 1.4 },
    });
    const water = element({
      id: 'water',
      category: 'water-feature',
      role: 'feature',
      name: 'Water',
      material: 'water-bowl',
      shape: { kind: 'point', at: { x: 18, y: 2 }, radius: 0.6 },
    });

    const image = render(scene([lawn, path, firePit, water, tree]));
    expect(at(image, 4, 12)).not.toEqual(at(image, 17, 12));
  });

  /**
   * A kept feature's fill is `rgba(...)`, the same string that `hexToRgb` threw on when the
   * Konva canvas shaded every rect. The composer already skipped a feature with no symbol;
   * a shed tagged existing still has to shade its roof from that fill.
   */
  it('draws a kept existing feature, including one with a roof, without throwing', () => {
    const kept = element({
      id: 'keep',
      category: 'existing-feature',
      role: 'feature',
      name: 'Existing store',
      material: 'existing',
      shape: { kind: 'rect', centre: { x: 16, y: 10 }, width: 2.5, depth: 2, rotation: 0 },
    });

    expect(() => render(scene([lawn, kept]))).not.toThrow();
    expect(() => render(scene([lawn, { ...kept, symbol: 'shed' }]))).not.toThrow();
  });
});

describe('firstFeatureIndex', () => {
  it('is the seam between fills and features, or the end when there are no features', () => {
    expect(firstFeatureIndex([lawn, patio, tree])).toBe(1);
    expect(firstFeatureIndex([lawn])).toBe(1);
    expect(firstFeatureIndex([])).toBe(0);
  });
});
