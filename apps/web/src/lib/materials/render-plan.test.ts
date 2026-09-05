import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  DesignElementSchema,
  rectangleHouse,
  SiteSectionSchema,
  type DesignElement,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
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

function render(input: PlanScene, pxPerMetre = PX): { pixels: Uint8ClampedArray; width: number } {
  const width = 20 * pxPerMetre;
  const height = 14 * pxPerMetre;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  drawPlan(context as unknown as PlanContext, input, { pxPerMetre, makeCanvas }, { x: 0, y: 0 });

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

  it('casts shadows only when the plan knows where it is', () => {
    const unlit = render(scene([lawn, tree]));
    const lit = render(
      scene([lawn, tree], {
        location: { latitude: 53.4, longitude: -2.98 },
        sun: { dayOfYear: 172, minutes: 600 },
      }),
    );

    // A patch of lawn nowhere near anything tall is the same in both.
    expect(at(lit, 2, 12)).toEqual(at(unlit, 2, 12));

    // But the lawn in the tree's morning shadow — which falls north-west, up and left on screen
    // with north up — is darker than the same lawn unlit.
    const shaded = at(lit, 13.5, 8.8);
    const open = at(unlit, 13.5, 8.8);
    expect(at(lit, 17.5, 11.5)).toEqual(at(unlit, 17.5, 11.5));
    const luminance = (rgba: number[]) => rgba[0]! + rgba[1]! + rgba[2]!;
    expect(luminance(shaded)).toBeLessThan(luminance(open));
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
