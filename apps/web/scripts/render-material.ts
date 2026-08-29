import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { boundingBox, type MaterialId, type Point } from '@garden-studio/schema';
import { resolvePattern } from '../src/lib/materials/palette';
import {
  drawSurfacePattern,
  type PatternContext,
} from '../src/lib/materials/render-surface-pattern';

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
 * leave a stale image behind to be mistaken for current output.
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
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

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
    write(`05-zoom-${String(scale).padStart(3, '0')}`, [{ outline: rectangle, seed: 'surface-a' }], scale);
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

  console.log(`Wrote ${written.length} PNGs to ${OUT_DIR}`);
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
      PLAN_ORIGIN,
      0,
      id,
      pxPerMetre,
      { x: 0, y: 0 },
    );

    context.fillStyle = 'rgba(255, 255, 255, 0.82)';
    context.fillRect(x * pxPerMetre, y * pxPerMetre, TILE.w * pxPerMetre, 18);
    context.fillStyle = '#1a231c';
    context.font = '12px sans-serif';
    context.fillText(`${id} · ${material.pattern.patternType}`, x * pxPerMetre + 6, y * pxPerMetre + 13);
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
      PLAN_ORIGIN,
      0,
      band.id,
      pxPerMetre,
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
      PLAN_ORIGIN,
      entry.rotation ?? 0,
      entry.seed,
      pxPerMetre,
      rasterOrigin,
    );
  }

  return canvas.toBuffer('image/png');
}

main();
