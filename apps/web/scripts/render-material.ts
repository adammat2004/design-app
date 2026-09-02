import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  boundingBox,
  DesignElementSchema,
  housePolygon,
  rectangleHouse,
  shadowCast,
  shadowOccluders,
  SiteSectionSchema,
  type MaterialId,
  type Point,
} from '@garden-studio/schema';
import { resolvePattern } from '../src/lib/materials/palette';
import {
  drawSurfacePattern,
  type PatternContext,
} from '../src/lib/materials/render-surface-pattern';
import { drawShadowLayer } from '../src/lib/materials/render-shadow-layer';
import { SHADOW_OPACITY } from '../src/lib/materials/light';

/**
 * Renders the material patterns to PNGs so they can be looked at.
 *
 * This is not a test — nothing here asserts anything. It exists because tuning tone jitter, joint
 * colour and bevel depth by reading numbers is guesswork: the only way to know whether a surface
 * reads as paving is to look at paving. Run it, open `.material-preview/`, change a constant in
 * `light.ts` or `palette.ts`, run it again.
 *
 *     pnpm --filter @garden-studio/web render:material
 *
 * The output directory is gitignored and cleared on every run, so a case that gets renamed cannot
 * leave a stale image behind to be mistaken for current output. The run it replaces is moved to
 * `.material-preview/before/` first — tuning is a comparison exercise, and you cannot judge a tone
 * by looking only at the after.
 */

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.material-preview');

/** Pixels per metre. 64 is twice the editor's default zoom — close enough to read the detail. */
const DEFAULT_PX_PER_METRE = 64;

const MATERIAL = resolvePattern('stone-pavers');
if (!MATERIAL) throw new Error('stone-pavers has no pattern manifest — nothing to render');

/**
 * One material per pattern type, plus every material in a contact sheet.
 *
 * The contact sheet is the important one. Materials are tuned against each other, not in
 * isolation: a lawn is only too dark next to the paving it abuts, and two planting materials that
 * look distinct on their own can be indistinguishable side by side, which is the failure that
 * matters — the user picks between them from a dropdown.
 */
const SHOWCASE: MaterialId[] = [
  'stone-pavers',
  'porcelain',
  'concrete',
  'stepping-stones',
  'timber-decking',
  'gravel-paving',
  'standard-turf',
  'artificial-turf',
  'wildflower',
  'mixed-border',
  'shrubs',
  'ornamental-grasses',
  'hedging',
  'ground-cover',
  'bark-mulch',
  'decorative-gravel',
  'play-bark',
  'slate-chippings',
  'softwood',
  'hardwood',
  'naturalistic-pond',
  'formal-pool',
  'rill',
  'water-bowl',
];

/* ---------------------------------------------------------------- the cases */

const rectangle: Point[] = [
  { x: 1, y: 1 },
  { x: 7, y: 1 },
  { x: 7, y: 5 },
  { x: 1, y: 5 },
];

const lShape: Point[] = [
  { x: 1, y: 1 },
  { x: 7, y: 1 },
  { x: 7, y: 3.4 },
  { x: 4, y: 3.4 },
  { x: 4, y: 6 },
  { x: 1, y: 6 },
];

/** A long thin wedge — the case where clipping either works or visibly does not. */
const acute: Point[] = [
  { x: 1, y: 1 },
  { x: 8, y: 3.2 },
  { x: 1, y: 4 },
];

/** Two patios butted along x = 5. Same origin, so the courses must run straight through. */
const leftOfSeam: Point[] = [
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 5, y: 5 },
  { x: 1, y: 5 },
];
const rightOfSeam: Point[] = [
  { x: 5, y: 1 },
  { x: 9, y: 1 },
  { x: 9, y: 5 },
  { x: 5, y: 5 },
];

const PLAN_ORIGIN: Point = { x: 0, y: 0 };

function main(): void {
  /*
   * Keep the last run before wiping, so a change can be judged against what it replaced.
   *
   * Clearing the directory every time is deliberate and stays — a renamed case must not leave a
   * stale image behind to be mistaken for current output. But visual tuning is entirely a
   * comparison exercise: you cannot tell whether a tone is better by looking only at the after.
   * One generation deep, so it cannot grow without bound, and `before/` is inside the gitignored
   * directory so neither is ever committed.
   */
  const beforeDir = join(OUT_DIR, 'before');

  if (existsSync(OUT_DIR)) {
    const carried = join(dirname(OUT_DIR), '.material-preview-carry');
    rmSync(carried, { recursive: true, force: true });
    cpSync(OUT_DIR, carried, { recursive: true });
    // Drop the previous run's own `before/`, or each run would nest one inside the last.
    rmSync(join(carried, 'before'), { recursive: true, force: true });

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    cpSync(carried, beforeDir, { recursive: true });
    rmSync(carried, { recursive: true, force: true });
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const written: string[] = [];

  const write = (name: string, outlines: Outline[], pxPerMetre = DEFAULT_PX_PER_METRE) => {
    writeFileSync(join(OUT_DIR, `${name}.png`), compose(outlines, pxPerMetre));
    written.push(name);
  };

  /* Shapes — does the grid clip correctly to an awkward outline? */
  write('01-rectangle', [{ outline: rectangle, seed: 'surface-a' }]);
  write('02-l-shape', [{ outline: lShape, seed: 'surface-a' }]);
  write('03-acute-angle', [{ outline: acute, seed: 'surface-a' }]);

  /*
   * Continuity — the important one. Two surfaces, drawn into a single image at their true relative
   * positions, sharing the plan origin. Every course must cross x = 5 without a step or a
   * half-slab. If this image shows a seam, world-space anchoring is broken.
   */
  write('04-shared-edge', [
    { outline: leftOfSeam, seed: 'surface-a' },
    { outline: rightOfSeam, seed: 'surface-b' },
  ]);

  /*
   * The same seam, cropped tight and zoomed in, where a half-slab step would be impossible to
   * miss. The wide view above can hide a small misalignment in a few pixels; this cannot.
   */
  write(
    '04-shared-edge-close',
    [
      { outline: clipToStrip(leftOfSeam, 3.5, 5), seed: 'surface-a' },
      { outline: clipToStrip(rightOfSeam, 5, 6.5), seed: 'surface-b' },
    ],
    220,
  );

  /*
   * Zoom — the joint must stay the same *real* width, so it thins in pixels as you zoom out.
   * 4 and 400 are the editor's `MIN_SCALE` and `MAX_SCALE`, so this spans everything reachable:
   * 4 falls below `MIN_DRAWN_MODULE_PX` and should come out as one flat tone, and 8 and 24 cross
   * the shading threshold. Those two transitions are the ones that look like a bug if they are
   * abrupt.
   */
  for (const scale of [4, 8, 24, 64, 160, 400]) {
    write(
      `05-zoom-${String(scale).padStart(3, '0')}`,
      [{ outline: rectangle, seed: 'surface-a' }],
      scale,
    );
  }

  /* Rotation — the courses turn, the grid stays anchored to the same origin. */
  for (const rotation of [0, 30, 45]) {
    write(`06-rotation-${rotation}`, [{ outline: rectangle, seed: 'surface-a', rotation }]);
  }

  /* A whole-garden view, for judging whether it reads as a render at a realistic zoom. */
  write('07-plan-scale', [{ outline: lShape, seed: 'surface-a' }], 32);

  /*
   * One tile per material, at the editor's default zoom and at a close one. Tuned against each
   * other rather than in isolation: two planting materials that look distinct alone but identical
   * side by side is the failure that matters, because the user picks between them in a dropdown.
   */
  for (const [scale, label] of [
    [32, 'plan'],
    [90, 'close'],
  ] as const) {
    writeFileSync(join(OUT_DIR, `08-materials-${label}.png`), contactSheet(scale));
    written.push(`08-materials-${label}`);
  }

  /*
   * The case the whole pass exists for: a lawn, a bed, gravel, decking and paving meeting each
   * other. Everything must be tellable apart at a glance, and no two may read as the same stuff.
   */
  writeFileSync(join(OUT_DIR, '09-together.png'), neighbours());
  written.push('09-together');

  /*
   * A whole garden, at four times of one day.
   *
   * The most informative sheet here, and it was found by accident: a throwaway script written to
   * check the shadow layer turned out to say far more than any single frame. The noon ratio is
   * visibly 1/tan(60 degrees) for this latitude, and the evening frame is the one where the house
   * throws a diagonal across the garden — which is the whole argument for the sun model. Four
   * frames also catch the thing a single frame cannot: whether the shadows and the surface
   * shading agree about where the light is as it moves.
   */
  writeFileSync(join(OUT_DIR, '10-shadow-hours.png'), shadowHours());
  written.push('09-together');

  written.push('10-shadow-hours');

  console.log(`Wrote ${written.length} PNGs to ${OUT_DIR}`);
  if (existsSync(beforeDir)) console.log(`Previous run kept in ${beforeDir} for comparison`);
  for (const name of written) console.log(`  ${name}.png`);
}

/* ---------------------------------------------------------------- material sheets */

const TILE = { w: 3.2, h: 2.4 };
const COLUMNS = 5;

/** Every patterned material as a labelled tile, so they can be compared at one zoom. */
function contactSheet(pxPerMetre: number): Buffer {
  const rows = Math.ceil(SHOWCASE.length / COLUMNS);
  const gap = 0.25;

  const width = Math.ceil((COLUMNS * (TILE.w + gap) + gap) * pxPerMetre);
  const height = Math.ceil((rows * (TILE.h + gap) + gap) * pxPerMetre);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  context.fillStyle = '#f4f2ed';
  context.fillRect(0, 0, width, height);

  SHOWCASE.forEach((id, index) => {
    const material = resolvePattern(id);
    if (!material) {
      console.warn(`  ! ${id} has no manifest entry — skipped`);
      return;
    }

    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = gap + column * (TILE.w + gap);
    const y = gap + row * (TILE.h + gap);

    const outline: Point[] = [
      { x, y },
      { x: x + TILE.w, y },
      { x: x + TILE.w, y: y + TILE.h },
      { x, y: y + TILE.h },
    ];

    /*
     * Each tile keeps the plan origin, so the tiles are windows onto one continuous world rather
     * than twenty separately-anchored swatches — which is also a free check that anchoring works.
     */
    drawSurfacePattern(
      context as unknown as PatternContext,
      outline,
      material,
      { origin: PLAN_ORIGIN, rotation: 0 },
      id,
      { pxPerMetre },
      { x: 0, y: 0 },
    );

    context.fillStyle = 'rgba(255, 255, 255, 0.82)';
    context.fillRect(x * pxPerMetre, y * pxPerMetre, TILE.w * pxPerMetre, 18);
    context.fillStyle = '#1a231c';
    context.font = '12px sans-serif';
    context.fillText(
      `${id} · ${material.pattern.patternType}`,
      x * pxPerMetre + 6,
      y * pxPerMetre + 13,
    );
  });

  return canvas.toBuffer('image/png');
}

/** Five materials meeting along shared edges, the way they do in a real garden. */
function neighbours(): Buffer {
  const pxPerMetre = 46;
  const plot = { w: 14, h: 9 };

  const width = Math.ceil((plot.w + 1) * pxPerMetre);
  const height = Math.ceil((plot.h + 1) * pxPerMetre);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f4f2ed';
  context.fillRect(0, 0, width, height);

  const rect = (x: number, y: number, w: number, h: number): Point[] => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

  const bands: { id: MaterialId; outline: Point[] }[] = [
    { id: 'standard-turf', outline: rect(0.5, 0.5, 13, 8) },
    { id: 'stone-pavers', outline: rect(0.5, 0.5, 5, 3.4) },
    { id: 'timber-decking', outline: rect(5.5, 0.5, 3.6, 3.4) },
    { id: 'mixed-border', outline: rect(0.5, 6.4, 13, 2.1) },
    { id: 'decorative-gravel', outline: rect(9.6, 0.5, 3.9, 3.4) },
    { id: 'shrubs', outline: rect(0.5, 3.9, 2.4, 2.5) },
  ];

  for (const band of bands) {
    const material = resolvePattern(band.id);
    if (!material) continue;

    drawSurfacePattern(
      context as unknown as PatternContext,
      band.outline,
      material,
      { origin: PLAN_ORIGIN, rotation: 0 },
      band.id,
      { pxPerMetre },
      { x: 0, y: 0 },
    );
  }

  return canvas.toBuffer('image/png');
}

/* ---------------------------------------------------------------- composition */

interface Outline {
  outline: Point[];
  seed: string;
  rotation?: number;
}

/**
 * Draws every outline into one image, in their true relative positions.
 *
 * That shared frame is the point: giving each surface its own image would make the seam case
 * unfalsifiable, because two separately-cropped rasters can always be slid until they line up.
 */
/**
 * Narrows a rectangle to the band between two x values, keeping its y extent.
 *
 * Only used to crop the seam cases in tight. It cuts the *outline*, not the pattern — the surfaces
 * stay in the same world position, so the slabs they show are the same slabs the wide view shows.
 * Cropping by moving the shapes together would prove nothing.
 */
function clipToStrip(outline: Point[], minX: number, maxX: number): Point[] {
  const ys = outline.map((point) => point.y);

  return [
    { x: minX, y: Math.min(...ys) },
    { x: maxX, y: Math.min(...ys) },
    { x: maxX, y: Math.max(...ys) },
    { x: minX, y: Math.max(...ys) },
  ];
}

function compose(outlines: Outline[], pxPerMetre: number): Buffer {
  const all = outlines.flatMap((entry) => entry.outline);
  const box = boundingBox(all);

  const margin = 0.5;
  const rasterOrigin: Point = { x: box.minX - margin, y: box.minY - margin };
  const width = Math.ceil((box.width + margin * 2) * pxPerMetre);
  const height = Math.ceil((box.length + margin * 2) * pxPerMetre);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  // A neutral ground, so a gap between two surfaces is obvious rather than reading as white paper.
  context.fillStyle = '#f4f2ed';
  context.fillRect(0, 0, width, height);

  for (const entry of outlines) {
    drawSurfacePattern(
      context as unknown as PatternContext,
      entry.outline,
      MATERIAL!,
      { origin: PLAN_ORIGIN, rotation: entry.rotation ?? 0 },
      entry.seed,
      { pxPerMetre },
      rasterOrigin,
    );
  }

  return canvas.toBuffer('image/png');
}

main();

/* ---------------------------------------------------------------- whole plan */

/** A garden with a house, a tree and a hedge in it, drawn at four times of one day. */
function shadowHours(): Buffer {
  const px = 26;
  const plotW = 22;
  const plotH = 15;
  const cols = 2;
  const rows = 2;
  const pad = 10;

  const plot: Point[] = [
    { x: 0, y: 0 },
    { x: plotW, y: 0 },
    { x: plotW, y: plotH },
    { x: 0, y: plotH },
  ];

  const house = rectangleHouse({ x: 11, y: 2.5 }, 9, 5);

  const element = (over: Record<string, unknown>) =>
    DesignElementSchema.parse({
      id: String(over.id),
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      ...over,
    });

  const elements = [
    element({
      id: 'lawn',
      category: 'lawn',
      role: 'fill',
      material: 'standard-turf',
      shape: { kind: 'rect', centre: { x: 11, y: 9.5 }, width: 20, depth: 8, rotation: 0 },
    }),
    element({
      id: 'patio',
      category: 'paved-area',
      role: 'fill',
      material: 'stone-pavers',
      shape: { kind: 'rect', centre: { x: 5, y: 7 }, width: 7, depth: 3.5, rotation: 0 },
    }),
    element({
      id: 'border',
      material: 'mixed-border',
      shape: { kind: 'rect', centre: { x: 11, y: 13.6 }, width: 20, depth: 2, rotation: 0 },
    }),
    element({
      id: 'hedge',
      material: 'hedging',
      shape: { kind: 'rect', centre: { x: 18.5, y: 9 }, width: 1, depth: 7, rotation: 0 },
    }),
    element({
      id: 'tree',
      shape: { kind: 'point', at: { x: 5, y: 11.5 }, radius: 1.6 },
      height: 5.5,
    }),
  ];

  const width = cols * plotW * px + (cols + 1) * pad;
  const height = rows * plotH * px + (rows + 1) * pad + rows * 18;

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f4f2ed';
  context.fillRect(0, 0, width, height);

  const hours: [string, number][] = [
    ['09:00', 540],
    ['12:00', 720],
    ['16:00', 960],
    ['19:00', 1140],
  ];

  hours.forEach(([label, minutes], index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const ox = pad + col * (plotW * px + pad);
    const oy = pad + row * (plotH * px + pad + 18) + 18;

    const site = SiteSectionSchema.parse({
      // Manchester, so the solstice noon altitude is 90 - 53.4 + 23.44 and the ratios are checkable.
      location: { latitude: 53.4, longitude: -2.98 },
      sun: { dayOfYear: 172, minutes },
      house,
    });

    const cast = shadowCast(site);
    const light = cast ? { x: -cast.direction.x, y: -cast.direction.y } : undefined;

    context.save();
    context.translate(ox, oy);

    context.fillStyle = '#e9ece4';
    context.fillRect(0, 0, plotW * px, plotH * px);

    for (const item of elements) {
      const material = resolvePattern(item.material);
      if (!material) continue;

      const outline = item.shape.kind === 'rect' ? rectOutline(item.shape) : [];
      if (outline.length < 3) continue;

      drawSurfacePattern(
        context as unknown as PatternContext,
        outline,
        material,
        { origin: PLAN_ORIGIN, rotation: 0 },
        item.id,
        { pxPerMetre: px, light },
        { x: 0, y: 0 },
      );
    }

    /*
     * The house, drawn before the shadows it casts. Without it the sheet shows a large shadow with
     * nothing visibly casting it, which is the one thing that makes these frames hard to read.
     */
    context.fillStyle = '#d9d2c4';
    context.beginPath();
    housePolygon(house).forEach((point, index) =>
      index === 0
        ? context.moveTo(point.x * px, point.y * px)
        : context.lineTo(point.x * px, point.y * px),
    );
    context.closePath();
    context.fill();

    if (cast) {
      const shade = createCanvas(plotW * px, plotH * px);
      drawShadowLayer(
        shade.getContext('2d') as unknown as PatternContext,
        shadowOccluders(elements, house),
        cast,
        plot,
        { pxPerMetre: px },
        { x: 0, y: 0 },
      );

      context.globalAlpha = SHADOW_OPACITY;
      context.drawImage(shade, 0, 0);
      context.globalAlpha = 1;
    }

    context.restore();

    context.fillStyle = '#1a231c';
    context.font = 'bold 13px sans-serif';
    context.fillText(
      `${label}  ·  shadow ${cast ? `${cast.lengthPerMetre.toFixed(2)}x height` : 'none (sun down)'}`,
      ox,
      oy - 6,
    );
  });

  return canvas.toBuffer('image/png');
}

function rectOutline(shape: { centre: Point; width: number; depth: number }): Point[] {
  const hw = shape.width / 2;
  const hd = shape.depth / 2;

  return [
    { x: shape.centre.x - hw, y: shape.centre.y - hd },
    { x: shape.centre.x + hw, y: shape.centre.y - hd },
    { x: shape.centre.x + hw, y: shape.centre.y + hd },
    { x: shape.centre.x - hw, y: shape.centre.y + hd },
  ];
}
