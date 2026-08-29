import {
  boundingBox,
  MM_PER_METRE,
  type MaterialPattern,
  type Point,
} from '@garden-studio/schema';
import {
  LIGHT_DIRECTION,
  MIN_SHADED_MODULE_PX,
  MODULE_BEVEL_RATIO,
  MODULE_HIGHLIGHT,
  MODULE_SHADOW,
  hexToRgb,
  rgbToCss,
  shiftBrightness,
} from './light';
import type { MaterialManifestEntry } from './palette';
import { moduleRandom, pick } from './prng';

/**
 * Procedural surface materials.
 *
 * The one rule this file exists to keep: **it has no authority.** It is handed an outline that
 * `geometryOutline` already produced, and it returns pixels. It never measures anything anybody
 * else relies on, never rounds a coordinate that gets stored, and never decides where a shape is.
 * Delete this directory and the plan is still dimensionally correct, just plainer.
 *
 * Two entry points. `drawSurfacePattern` does all the work against a 2D context, so the tests can
 * hand it an `@napi-rs/canvas` one — jsdom has no 2D context at all, and mounting Konva in a unit
 * test is something this repo deliberately never does. `renderSurfacePattern` wraps it in a canvas
 * of the right size, taking the canvas factory as an argument so the browser path can pass its own
 * without this module importing anything Node-only.
 *
 * Four pattern types share one preamble — clip, lay the background, decide the level of detail —
 * and then diverge. Adding a fifth should be a case in `paint`, not a second pipeline.
 */

/** How much a unit's tone may drift from its palette entry, either way. */
const TONE_JITTER = 0.03;

/**
 * The smallest module, in pixels, still worth drawing individually. Below it the surface is filled
 * with one averaged tone: at two pixels a slab the joints alias into a grey haze that costs a
 * thousand fill calls to produce and looks worse than a flat colour.
 */
const MIN_DRAWN_MODULE_PX = 3;

/**
 * The scatter equivalent. Below this a unit is too small to read as a thing, and a bed of ten
 * thousand sub-pixel blobs is both slower and worse-looking than the averaged tone.
 *
 * Lower than the module floor, and deliberately: a gravel chipping really is about a pixel and a
 * half at a normal editing zoom, and at 2.5 every aggregate in the app fell back to a single flat
 * colour and read as dead beige card. A stone drawn at a pixel and a half is grain rather than a
 * stone, which is exactly what gravel looks like from standing height.
 */
const MIN_DRAWN_UNIT_PX = 1.4;

/**
 * A hard ceiling on scattered units per raster.
 *
 * Density is per square metre, so a large bed at a deep zoom can ask for a genuinely enormous
 * number. The level-of-detail floor catches the zoomed-*out* case; this catches the zoomed-in one,
 * where each unit is big but the raster covers a lot of ground.
 */
const MAX_SCATTER_UNITS = 40_000;

/** Everything the renderer needs of a canvas, so any 2D canvas implementation satisfies it. */
export interface PatternCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): PatternContext | null;
}

/**
 * The 2D context surface actually used. Narrowed to what is drawn with, rather than taking the
 * DOM's `CanvasRenderingContext2D`, because `@napi-rs/canvas`'s context is structurally the same
 * but not that nominal type.
 */
export interface PatternContext {
  fillStyle: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  clip(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

export type MakeCanvas = (width: number, height: number) => PatternCanvas;

/** Where a surface's raster sits in the world, so a caller can position the image it gets back. */
export interface PatternRaster {
  canvas: PatternCanvas;
  /** World metres — the top-left corner the raster covers. */
  originMetres: Point;
  /** Pixels per metre the raster was drawn at. May differ from the live zoom; scale the image. */
  pxPerMetre: number;
  widthPx: number;
  heightPx: number;
}

/**
 * The largest raster, per side, we will produce. A surface zoomed right in is clamped rather than
 * allowed to allocate a canvas the size of the garden times four hundred — 4096² is 64 MB of
 * RGBA, and the plan can hold a dozen of them.
 */
const MAX_RASTER_PX = 4096;

/* ---------------------------------------------------------------- entry points */

/**
 * Rasterises one surface's material.
 *
 * Returns `null` for a degenerate outline — a polygon still being drawn can be a straight line,
 * which has no area to fill.
 */
export function renderSurfacePattern(
  outline: Point[],
  material: MaterialManifestEntry,
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  makeCanvas: MakeCanvas,
): PatternRaster | null {
  const box = boundingBox(outline);
  if (box.width <= 0 || box.length <= 0 || pxPerMetre <= 0) return null;

  /*
   * Clamped rather than refused: a very large surface at a very deep zoom is a legitimate thing to
   * look at, and a slightly soft raster is a better answer than no paving at all.
   */
  const scale = Math.min(pxPerMetre, MAX_RASTER_PX / box.width, MAX_RASTER_PX / box.length);

  const widthPx = Math.max(1, Math.ceil(box.width * scale));
  const heightPx = Math.max(1, Math.ceil(box.length * scale));

  const canvas = makeCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (!context) return null;

  const originMetres = { x: box.minX, y: box.minY };

  drawSurfacePattern(context, outline, material, origin, rotation, seed, scale, originMetres);

  return { canvas, originMetres, pxPerMetre: scale, widthPx, heightPx };
}

/**
 * Draws one surface's material into a context.
 *
 * `rasterOrigin` is the world point the context's own `(0, 0)` corresponds to. It defaults to the
 * outline's bounding-box corner, which is what `renderSurfacePattern` wants; the harness and the
 * tests override it to draw two surfaces into one image in their true relative positions, which is
 * the only way to see whether the courses actually line up across a shared edge.
 */
export function drawSurfacePattern(
  context: PatternContext,
  outline: Point[],
  material: MaterialManifestEntry,
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  rasterOrigin: Point = boundingBoxOrigin(outline),
): void {
  if (outline.length < 3) return;

  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  context.save();

  /*
   * Clip first, then lay the background across the whole clipped region. For paving the background
   * is the mortar joint, and drawing it this way rather than stroking lines between modules is
   * what keeps the joint the correct real width at every zoom — a stroke has to be given a pixel
   * width, which either disappears zoomed out or swells to a fat border zoomed in. For a planting
   * bed the same fill is the soil the plants sit on.
   */
  context.beginPath();
  const first = toPx(outline[0]!);
  context.moveTo(first.x, first.y);
  for (let i = 1; i < outline.length; i += 1) {
    const at = toPx(outline[i]!);
    context.lineTo(at.x, at.y);
  }
  context.closePath();
  context.clip();

  context.fillStyle = material.jointColour;
  context.fill();

  if (tooSmallToRead(material.pattern, pxPerMetre)) {
    // One averaged tone, and no thousand-fill sweep to produce something nobody can resolve.
    context.fillStyle = averageTone(material.palette);
    context.fill();
    context.restore();
    return;
  }

  /*
   * From here on the context works in *pattern space*: origin at the surface's pattern origin,
   * axes along the course direction. Doing it with a transform rather than rotating every unit by
   * hand is what keeps a rotated module a rectangle — `fillRect` in a rotated frame is exactly the
   * rotated slab we want, with no tessellation of our own anywhere near it.
   */
  const originPx = toPx(origin);
  context.translate(originPx.x, originPx.y);
  context.rotate((rotation * Math.PI) / 180);

  paint(context, material, outline, origin, rotation, seed, pxPerMetre);

  context.restore();
}

/** Dispatch. Everything above this line is shared by every pattern; everything below diverges. */
function paint(
  context: PatternContext,
  material: MaterialManifestEntry,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
): void {
  const { pattern } = material;

  switch (pattern.patternType) {
    case 'grid':
    case 'board':
      paintModules(context, material, pattern, outline, origin, rotation, seed, pxPerMetre);
      return;
    case 'scatter':
      paintScatter(context, material, pattern, outline, origin, rotation, seed, pxPerMetre);
      return;
    case 'stripe':
      paintStripes(context, material, pattern, outline, origin, rotation, seed, pxPerMetre);
      return;
  }
}

/* ---------------------------------------------------------------- grid and board */

function paintModules(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'grid' | 'board' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
): void {
  const moduleWidth = pattern.moduleSize.w / MM_PER_METRE;
  const moduleHeight = pattern.moduleSize.h / MM_PER_METRE;
  const joint = pattern.jointWidth / MM_PER_METRE;
  const pitchX = moduleWidth + joint;
  const pitchY = moduleHeight + joint;

  /*
   * Boards are staggered half a module row on row. A deck laid with its butt joints in line is a
   * deck laid wrong, and it is the one thing that separates decking from very long tiles.
   */
  const stagger = pattern.patternType === 'board' ? 0.5 : 0;

  const modulePx = Math.min(moduleWidth, moduleHeight) * pxPerMetre;
  const shaded = modulePx >= MIN_SHADED_MODULE_PX;
  // At least a whole pixel, or the bevel is drawn at a fraction of one and simply does not appear.
  const bevel = Math.max(1, Math.round(modulePx * MODULE_BEVEL_RATIO));

  const range = gridRange(outline, origin, rotation, pitchX, pitchY);
  // A staggered row reaches half a module further either way than its own column bounds suggest.
  const minCol = range.minCol - (stagger > 0 ? 1 : 0);

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const offset = row % 2 === 0 ? 0 : stagger * pitchX;

    for (let col = minCol; col <= range.maxCol; col += 1) {
      drawModule(context, {
        col,
        row,
        seed,
        palette: material.palette,
        // Half a joint of inset per side, so the gap *between* two modules is one full joint.
        x: (col * pitchX + offset + joint / 2) * pxPerMetre,
        y: (row * pitchY + joint / 2) * pxPerMetre,
        width: moduleWidth * pxPerMetre,
        height: moduleHeight * pxPerMetre,
        shaded,
        bevel,
      });
    }
  }
}

interface ModuleDraw {
  col: number;
  row: number;
  seed: string;
  palette: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  shaded: boolean;
  bevel: number;
}

function drawModule(context: PatternContext, module: ModuleDraw): void {
  const random = moduleRandom(module.seed, module.col, module.row);

  const base = hexToRgb(pick(module.palette, random()));
  // Symmetric about zero, so jitter varies a tone rather than systematically darkening the surface.
  const tone = shiftBrightness(base, (random() * 2 - 1) * TONE_JITTER);

  context.fillStyle = rgbToCss(tone);
  context.fillRect(module.x, module.y, module.width, module.height);

  if (!module.shaded || module.bevel <= 0) return;

  /*
   * The bevel: two lit edges and two unlit, decided once by `LIGHT_DIRECTION` so every module in
   * the app catches the sun from the same side. Drawn as strips inside the module's own rectangle
   * rather than as an outline, so the shading is part of the slab rather than a border between
   * slabs — a border would read as a second, wrong-coloured joint.
   */
  const lit = rgbToCss(shiftBrightness(tone, MODULE_HIGHLIGHT));
  const unlit = rgbToCss(shiftBrightness(tone, -MODULE_SHADOW));

  const left = LIGHT_DIRECTION.x < 0;
  const top = LIGHT_DIRECTION.y < 0;

  context.fillStyle = left ? lit : unlit;
  context.fillRect(module.x, module.y, module.bevel, module.height);
  context.fillStyle = left ? unlit : lit;
  context.fillRect(module.x + module.width - module.bevel, module.y, module.bevel, module.height);

  context.fillStyle = top ? lit : unlit;
  context.fillRect(module.x, module.y, module.width, module.bevel);
  context.fillStyle = top ? unlit : lit;
  context.fillRect(module.x, module.y + module.height - module.bevel, module.width, module.bevel);
}

/* ---------------------------------------------------------------- scatter */

function paintScatter(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'scatter' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
): void {
  /*
   * A jittered grid, not true Poisson-disc sampling.
   *
   * One cell holds one unit, placed somewhere inside it by the cell's own generator. That is what
   * makes the scatter deterministic *per cell* — exactly the property `moduleRandom` gives slabs,
   * and the reason re-clipping a bed after a vertex drag cannot reshuffle the plants that did not
   * move. Poisson sampling is prettier and sequential, and sequential is precisely what would make
   * the whole bed repaint every time its outline changed.
   */
  const cell = 1 / Math.sqrt(pattern.density);
  const range = gridRange(outline, origin, rotation, cell, cell);

  const cells = (range.maxCol - range.minCol + 1) * (range.maxRow - range.minRow + 1);
  if (cells > MAX_SCATTER_UNITS) return;

  const minSize = pattern.sizeRange.min / MM_PER_METRE;
  const maxSize = pattern.sizeRange.max / MM_PER_METRE;

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const random = moduleRandom(seed, col, row);

      const tone = shiftBrightness(
        hexToRgb(pick(material.palette, random())),
        (random() * 2 - 1) * TONE_JITTER,
      );
      const size = minSize + random() * (maxSize - minSize);

      /*
       * Jittered a full cell width, so the grid the units were laid out on is not visible in the
       * result. Anything less and a bed reads as rows of plants.
       */
      const centreX = (col + random()) * cell;
      const centreY = (row + random()) * cell;

      drawBlob(context, {
        x: centreX * pxPerMetre,
        y: centreY * pxPerMetre,
        radius: (size / 2) * pxPerMetre,
        lobes: pattern.lobes,
        tone,
        random,
      });
    }
  }
}

interface BlobDraw {
  x: number;
  y: number;
  radius: number;
  lobes: number;
  tone: { r: number; g: number; b: number };
  random: () => number;
}

/**
 * One scattered unit: a shrub, a bark chip, a piece of gravel.
 *
 * A closed loop of quadratic curves through jittered points around a circle. Curves rather than a
 * straight-sided polygon because at three or four lobes a polygon reads as a triangle or a
 * diamond — an obviously drawn shape — where the curve reads as a stone. The lobe count is what
 * separates gravel from planting: four is angular, nine is leafy.
 */
function drawBlob(context: PatternContext, blob: BlobDraw): void {
  const reaches: number[] = [];
  for (let i = 0; i < blob.lobes; i += 1) {
    // Never below 65% of the radius, or a lobe folds through the centre and the blob self-crosses.
    reaches.push(blob.radius * (0.65 + blob.random() * 0.45));
  }

  context.fillStyle = rgbToCss(blob.tone);
  traceBlob(context, blob, reaches, 1, 0, 0);
  context.fill();

  if (blob.radius < MIN_SHADED_MODULE_PX) return;

  /*
   * The lit crown: the plant's *own* outline, shrunk and shifted towards the light.
   *
   * Drawn as a scaled copy rather than as a circle laid on top, which is what the first attempt
   * did and which made every shrub look like a fried egg — a hard round highlight reads as a
   * separate object, where a smaller copy of the same ragged shape reads as the top of this one
   * catching the sun. Same `LIGHT_DIRECTION` as every slab bevel, so a bed and the patio beside it
   * are lit from the same place.
   */
  const offset = blob.radius * 0.22;
  context.fillStyle = rgbToCss(shiftBrightness(blob.tone, MODULE_HIGHLIGHT));
  traceBlob(context, blob, reaches, 0.62, LIGHT_DIRECTION.x * offset, LIGHT_DIRECTION.y * offset);
  context.fill();
}

/**
 * Lays down a closed loop of quadratic curves through the lobe points.
 *
 * Curves rather than straight edges because at four or five lobes a polygon reads as a triangle or
 * a diamond — an obviously drawn shape — where the curve reads as a stone or a plant. Each vertex
 * is a control point and each edge midpoint an anchor, which is the standard way to round a
 * polygon without computing tangents.
 */
function traceBlob(
  context: PatternContext,
  blob: BlobDraw,
  reaches: number[],
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const at = (index: number): Point => {
    const angle = (index / reaches.length) * Math.PI * 2;
    const reach = reaches[index % reaches.length]! * scale;

    return {
      x: blob.x + offsetX + Math.cos(angle) * reach,
      y: blob.y + offsetY + Math.sin(angle) * reach,
    };
  };

  const midpointOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  context.beginPath();

  // Start on the midpoint of the closing edge, so every vertex can be a control point.
  const start = midpointOf(at(reaches.length - 1), at(0));
  context.moveTo(start.x, start.y);

  for (let i = 0; i < reaches.length; i += 1) {
    const current = at(i);
    const anchor = midpointOf(current, at(i + 1));
    context.quadraticCurveTo(current.x, current.y, anchor.x, anchor.y);
  }

  context.closePath();
}

/* ---------------------------------------------------------------- stripe */

function paintStripes(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'stripe' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
): void {
  const band = pattern.bandWidth / MM_PER_METRE;

  /*
   * The stripe angle turns inside pattern space, on top of the surface's own rotation. Rotating
   * the context again rather than folding the two angles into the range calculation keeps the
   * bands as plain axis-aligned rectangles, which is the only reason this case is six lines.
   */
  context.rotate((pattern.angle * Math.PI) / 180);

  const total = rotation + pattern.angle;
  const range = gridRange(outline, origin, total, band, band);

  // Long enough to cross the surface at any angle: the bounding box's diagonal, doubled.
  const span = spanOf(outline) * pxPerMetre;

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const random = moduleRandom(seed, 0, row);

    // Alternating, so the mower reads as having gone up and back rather than in one direction.
    const base = hexToRgb(material.palette[Math.abs(row) % material.palette.length]!);
    const tone = shiftBrightness(base, (random() * 2 - 1) * TONE_JITTER);

    context.fillStyle = rgbToCss(tone);
    context.fillRect(-span, row * band * pxPerMetre, span * 2, band * pxPerMetre);
  }
}

/* ---------------------------------------------------------------- the grid */

interface GridRange {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * Which cells could possibly touch this outline.
 *
 * The grid is generated across the outline's extent **from the pattern origin**, never relative to
 * the outline itself. That is the whole of world-space continuity: two adjacent surfaces sharing an
 * origin and a rotation compute the same `col`/`row` for the same patch of ground, so they draw the
 * same unit in the same place and the seam between them disappears.
 *
 * The outline's corners are carried into pattern space and bounded there, rather than bounding them
 * in world space and rotating the box — a rotated bounding box is not a bounding box, and the
 * difference shows up as a missing row of slabs along one edge at 30°.
 */
function gridRange(
  outline: Point[],
  origin: Point,
  rotation: number,
  pitchX: number,
  pitchY: number,
): GridRange {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const point of outline) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    // The inverse of a clockwise rotation by `rotation`, in this y-down frame.
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;

    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  return {
    minCol: Math.floor(minU / pitchX),
    maxCol: Math.ceil(maxU / pitchX),
    minRow: Math.floor(minV / pitchY),
    maxRow: Math.ceil(maxV / pitchY),
  };
}

/* ---------------------------------------------------------------- helpers */

/** Whether a unit of this pattern is too small at this zoom to be worth drawing individually. */
function tooSmallToRead(pattern: MaterialPattern, pxPerMetre: number): boolean {
  switch (pattern.patternType) {
    case 'grid':
    case 'board': {
      const smallest = Math.min(pattern.moduleSize.w, pattern.moduleSize.h) / MM_PER_METRE;
      return smallest * pxPerMetre < MIN_DRAWN_MODULE_PX;
    }
    case 'scatter':
      return (pattern.sizeRange.max / MM_PER_METRE) * pxPerMetre < MIN_DRAWN_UNIT_PX;
    case 'stripe':
      // A band is metres wide; it only stops reading when the whole surface is a few pixels.
      return (pattern.bandWidth / MM_PER_METRE) * pxPerMetre < MIN_DRAWN_MODULE_PX;
  }
}

function boundingBoxOrigin(outline: Point[]): Point {
  const box = boundingBox(outline);
  return { x: box.minX, y: box.minY };
}

/** The outline's diagonal, in metres — long enough to cross it whatever way a band runs. */
function spanOf(outline: Point[]): number {
  const box = boundingBox(outline);
  return Math.hypot(box.width, box.length) + Math.hypot(box.minX, box.minY);
}

/** The palette's mean, for the zoomed-right-out case where individual units cannot be seen. */
function averageTone(palette: string[]): string {
  const total = palette.reduce(
    (sum, hex) => {
      const { r, g, b } = hexToRgb(hex);
      return { r: sum.r + r, g: sum.g + g, b: sum.b + b };
    },
    { r: 0, g: 0, b: 0 },
  );

  return rgbToCss({
    r: total.r / palette.length,
    g: total.g / palette.length,
    b: total.b / palette.length,
  });
}
