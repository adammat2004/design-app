import {
  boundingBox,
  MM_PER_METRE,
  scatterForm,
  type MaterialPattern,
  type Point,
} from '@garden-studio/schema';
import {
  LIGHT_DIRECTION,
  MODULE_BEVEL_RATIO,
  MODULE_HIGHLIGHT,
  MODULE_SHADOW,
  hexToRgb,
  rgbToCss,
  shiftBrightness,
} from './light';
import { edgeFor, type MaterialManifestEntry } from './palette';
import { shadesAt, tierFor } from './lod';
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
 * Five pattern types share one preamble — clip, lay the background, decide the level of detail —
 * and then diverge. Adding a sixth should be a case in `paint`, not a second pipeline.
 *
 * ```
 *   outline ─▶ clip to it ─▶ fill jointColour ─▶ tierFor() === mass? ─yes─▶ one averaged tone
 *   (world m)   (the only        (the ground        │                     (done)
 *                clip here)      behind units)      no
 *                                                   ▼
 *                                              paint() ── dispatch on patternType
 *                    ┌──────────────┬──────────────┼──────────────┬──────────────┐
 *                    ▼              ▼              ▼              ▼              ▼
 *                 grid          board          scatter         water         stripe
 *                    └──── drawModule ────┘        │              │             │
 *                         (bevel: light)           │         (crests: light)    │
 *                                                  ▼                            │
 *                                         scatterForm() ──▶ blob / tufted /     │
 *                                                           clipped-mass        │
 *                                                    (highlight: light) ────────┘
 *
 *   `light` is the same unit vector everywhere it appears above, and the same one the cast
 *   shadow layer uses. That agreement is most of what separates a render from a diagram.
 * ```
 */

/** How much a unit's tone may drift from its palette entry, either way. */
const TONE_JITTER = 0.03;

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
  /**
   * Stroking is used for exactly one thing: the cut edge where a surface meets whatever it sits
   * on. Because the context is already clipped to the outline, a stroke centred on that outline
   * renders only its inner half — which is precisely a bed's cut edge, with no inset polygon to
   * compute. Widening the interface for it is safe: this is narrowed to avoid the DOM's *nominal*
   * type, not to avoid capability, and both the DOM and `@napi-rs/canvas` have all three.
   */
  strokeStyle: string;
  lineWidth: number;
  stroke(): void;
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

/**
 * Where a surface's pattern starts and which way its courses run.
 *
 * Exactly the shape `patternAnchor()` in the shared package already returns, so the two travel
 * together instead of being taken apart into positional arguments and reassembled here.
 */
export interface PatternAnchor {
  origin: Point;
  rotation: number;
}

/**
 * Everything about the drawing *pass* rather than about the surface being drawn.
 *
 * This exists because the argument lists were about to get away from us. `drawSurfacePattern`
 * already took eight positional parameters, and the render work coming needs three more that are
 * cross-cutting rather than per-surface — where the sun is, which level of detail this zoom
 * warrants, and how tall the thing is. Threaded positionally that is eleven arguments, and every
 * new one means editing every signature and every call site again.
 *
 * Deliberately NOT a React context. `use-surface-pattern.ts` is the only React in this directory
 * and everything below it is a pure function of data, which is what lets the renderer be tested
 * against a real canvas in Node without mounting anything. A plain value object keeps that.
 */
export interface DrawPass {
  /** Pixels per metre this pass draws at. */
  pxPerMetre: number;
  /**
   * Unit vector pointing **towards** the light, in plan space.
   *
   * Optional, defaulting to the conventional top-left drawing light. When the plan knows where it
   * is, `lightDirection(site)` supplies the real sun instead — and then the slab bevels, the blob
   * highlights and the cast shadows are all lit by one source. Two suns in one drawing is the
   * most obvious way a render gives itself away.
   */
  light?: Point;
}

/** A `DrawPass` that also has to allocate its own canvas. */
export interface RenderPass extends DrawPass {
  makeCanvas: MakeCanvas;
}

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
  anchor: PatternAnchor,
  seed: string,
  pass: RenderPass,
): PatternRaster | null {
  const { pxPerMetre, makeCanvas } = pass;

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

  drawSurfacePattern(context, outline, material, anchor, seed, { pxPerMetre: scale }, originMetres);

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
  anchor: PatternAnchor,
  seed: string,
  pass: DrawPass,
  rasterOrigin: Point = boundingBoxOrigin(outline),
): void {
  const { origin, rotation } = anchor;
  const { pxPerMetre } = pass;
  const light = pass.light ?? LIGHT_DIRECTION;

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

  if (tierFor(material.pattern, pxPerMetre) === 'mass') {
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

  paint(context, material, outline, origin, rotation, seed, pxPerMetre, light);

  drawCutEdge(context, material, outline, pxPerMetre, toPx);

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
  light: Point,
): void {
  const { pattern } = material;

  switch (pattern.patternType) {
    case 'grid':
    case 'board':
      paintModules(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, light);
      return;
    case 'scatter':
      paintScatter(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, light);
      return;
    case 'water':
      paintWater(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, light);
      return;
    case 'stripe':
      // Mown stripes are flat bands of one grass catching the light two ways; there is no lit
      // edge to place, so the sun does not reach this branch.
      paintStripes(context, material, pattern, outline, origin, rotation, seed, pxPerMetre);
      return;
  }
}

/**
 * The cut edge, drawn last and still inside the clip.
 *
 * Inside the clip is what makes this cheap. A stroke is centred on the path it follows, so half of
 * it falls outside the outline and is clipped away — leaving exactly the inner half, which is a
 * bed's spade-cut edge. Computing an inset polygon to fill instead would be real work for the same
 * picture, and would have to handle a concave outline eating itself.
 *
 * Drawn after the pattern rather than before it, or the units scattered near the boundary would
 * cover the line they are supposed to be contained by.
 */
function drawCutEdge(
  context: PatternContext,
  material: MaterialManifestEntry,
  outline: Point[],
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  const edge = edgeFor(material.category);
  if (!edge) return;

  const widthPx = (edge.widthMm / MM_PER_METRE) * pxPerMetre;

  /*
   * Below a pixel the stroke stops being a line and becomes a wash of anti-aliasing over the whole
   * boundary, which reads as a halo rather than as an edge — the same reasoning that gives module
   * shading a minimum size.
   */
  if (widthPx < 1) return;

  context.beginPath();
  outline.forEach((point, index) => {
    const at = toPx(point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.closePath();

  // Doubled, because the clip throws the outer half away.
  context.lineWidth = widthPx * 2;
  context.strokeStyle = edge.colour;
  context.stroke();
}

/* ---------------------------------------------------------------- water */

/**
 * Water, from above.
 *
 * Three things in order, and the order is the whole effect: the body, the depth at its margin,
 * then the light coming back off the surface. Drawn the other way round the specular sits under
 * the shading and the pool reads as wet stone.
 *
 * The specular is placed by the same light every slab bevel and every plant crown uses, so a pond
 * beside a patio catches the sun from the same place. That agreement is most of what separates a
 * render from a diagram, and water is where its absence is most obvious — a highlight on the wrong
 * side of a pool reads as a mistake even to someone who could not say why.
 */
function paintWater(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'water' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  light: Point,
): void {
  const box = boundingBox(outline);
  const width = box.width * pxPerMetre;
  const height = box.length * pxPerMetre;
  const left = (box.minX - origin.x) * pxPerMetre;
  const top = (box.minY - origin.y) * pxPerMetre;

  const body = hexToRgb(material.palette[0] ?? material.jointColour);

  context.fillStyle = rgbToCss(body);
  context.fillRect(left, top, width, height);

  /*
   * Still water gets nothing more, and that is the point of it. A formal pool is meant to read as
   * a mirror, so `rippleSpacing` of 0 is a design statement rather than a missing value.
   */
  if (pattern.rippleSpacing <= 0) return;

  const spacing = (pattern.rippleSpacing / MM_PER_METRE) * pxPerMetre;
  if (spacing < 3) return;

  /*
   * Fine broken lines, brighter on the lit side, and nothing else.
   *
   * The first attempt drew a broad rectangular sheen in the middle. It was wrong twice over: a
   * hard-edged slab of pale colour reads as a UI panel rather than as light, and even softened it
   * would still be wrong, because a bright patch in the centre of a pond is not how water is drawn
   * in plan. What reads as water is a few crest lines catching the sun — so the light does not get
   * its own shape here, it just decides which crests are brightest.
   *
   * `PatternContext` has no gradients and no alpha by design, so softness is not available. That
   * turns out not to matter: the marks are one or two pixels of low contrast, and at that size a
   * hard edge is invisible.
   */
  const random = moduleRandom(seed, 0, 0);
  const rows = Math.ceil(height / spacing);

  for (let i = 0; i < rows; i += 1) {
    const y = top + i * spacing + random() * spacing * 0.4;

    // How far down the lit axis this crest sits, 0 at the shaded edge and 1 at the lit one.
    const along =
      light.y >= 0 ? (y - top) / Math.max(height, 1) : 1 - (y - top) / Math.max(height, 1);

    const inset = width * (0.05 + random() * 0.28);
    const run = (width - inset * 2) * (0.35 + random() * 0.5);

    context.fillStyle = rgbToCss(shiftBrightness(body, MODULE_HIGHLIGHT * (0.5 + along * 1.6)));
    context.fillRect(left + inset, y, run, Math.max(1, spacing * 0.1));
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
  light: Point,
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
  const shaded = shadesAt(modulePx);
  // At least a whole pixel, or the bevel is drawn at a fraction of one and simply does not appear.
  const bevel = Math.max(1, Math.round(modulePx * MODULE_BEVEL_RATIO));

  const range = gridRange(outline, origin, rotation, pitchX, pitchY);
  // A staggered row reaches half a module further either way than its own column bounds suggest.
  const minCol = range.minCol - (stagger > 0 ? 1 : 0);

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const offset = row % 2 === 0 ? 0 : stagger * pitchX;

    for (let col = minCol; col <= range.maxCol; col += 1) {
      drawModule(context, {
        light,
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
  /** Unit vector towards the light. Carried per module so one pass cannot mix two suns. */
  light: Point;
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
   * The bevel: two lit edges and two unlit, decided by the pass's light so every module in
   * the app catches the sun from the same side. Drawn as strips inside the module's own rectangle
   * rather than as an outline, so the shading is part of the slab rather than a border between
   * slabs — a border would read as a second, wrong-coloured joint.
   */
  const lit = rgbToCss(shiftBrightness(tone, MODULE_HIGHLIGHT));
  const unlit = rgbToCss(shiftBrightness(tone, -MODULE_SHADOW));

  const left = module.light.x < 0;
  const top = module.light.y < 0;

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
  light: Point,
): void {
  const form = scatterForm(pattern);

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
        light,
        form,
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
  /** Unit vector towards the light, the same one the slab bevels use. */
  light: Point;
  /** What this unit is shaped like. Resolved by `scatterForm` before it gets here. */
  form: 'blob' | 'tufted' | 'clipped-mass';
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
  if (blob.form === 'tufted') {
    drawTuft(context, blob);
    return;
  }

  /*
   * A clipped hedge is not a loose bobble. Keeping the reaches in a narrow band makes each unit
   * nearly circular, so at this density they overlap into one scalloped band with a defined edge
   * — which is how a hedge has always been drawn in plan by hand — rather than reading as a row
   * of separate shrubs.
   */
  const spread =
    blob.form === 'clipped-mass' ? { base: 0.92, jitter: 0.14 } : { base: 0.65, jitter: 0.45 };

  const reaches: number[] = [];
  for (let i = 0; i < blob.lobes; i += 1) {
    // Never below 65% of the radius, or a lobe folds through the centre and the blob self-crosses.
    reaches.push(blob.radius * (spread.base + blob.random() * spread.jitter));
  }

  context.fillStyle = rgbToCss(blob.tone);
  traceBlob(context, blob, reaches, 1, 0, 0);
  context.fill();

  /*
   * A radius against a threshold named for a full dimension, which is what this has always
   * compared. Arguably over-conservative — a blob 16 px across goes unshaded where a slab of the
   * same size would not — but it is preserved exactly here rather than corrected, because this
   * refactor's gate is that it changes no pixels. Noted in TODOS.md as a tuning candidate.
   */
  if (!shadesAt(blob.radius)) return;

  /*
   * The lit crown: the plant's *own* outline, shrunk and shifted towards the light.
   *
   * Drawn as a scaled copy rather than as a circle laid on top, which is what the first attempt
   * did and which made every shrub look like a fried egg — a hard round highlight reads as a
   * separate object, where a smaller copy of the same ragged shape reads as the top of this one
   * catching the sun. The same light as every slab bevel, so a bed and the patio beside it
   * are lit from the same place.
   */
  const offset = blob.radius * 0.22;
  context.fillStyle = rgbToCss(shiftBrightness(blob.tone, MODULE_HIGHLIGHT));
  traceBlob(context, blob, reaches, 0.62, blob.light.x * offset, blob.light.y * offset);
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
/**
 * A grass, from above.
 *
 * Ornamental grasses were the clearest failure of drawing every planting material as the same
 * round lobed blob: from above a grass is a *rosette of radiating leaves*, not a mound, and no
 * amount of size, density or hue turns one into the other. That is the whole argument for a form
 * axis — colour can substitute for shape up to a point, which is why `wildflower` and
 * `mixed-border` already read well, but a grass is a different shape from a shrub.
 *
 * Each blade is filled on its own path rather than all of them into one. A single path would be
 * fewer calls, but the blades all meet at the centre and the non-zero winding rule cancels
 * overlapping subpaths against each other — which would punch a hole through the middle of every
 * tuft. Planting densities are single figures per square metre, so the extra fills are cheap; the
 * aggregates that run to hundreds per square metre are all `blob`.
 */
function drawTuft(context: PatternContext, blob: BlobDraw): void {
  const blades: { angle: number; reach: number }[] = [];

  for (let i = 0; i < blob.lobes; i += 1) {
    blades.push({
      // Evenly spaced, then jittered by less than half a step so leaves never cross over.
      angle:
        (i / blob.lobes) * Math.PI * 2 + (blob.random() - 0.5) * ((Math.PI * 2) / blob.lobes) * 0.8,
      // Less length variance than a blob's lobes: a rosette is roughly round overall.
      reach: blob.radius * (0.72 + blob.random() * 0.34),
    });
  }

  context.fillStyle = rgbToCss(blob.tone);
  traceBlades(context, blob, blades, 1, 0, 0);

  /*
   * A radius against a threshold named for a full dimension, which is what this has always
   * compared. Arguably over-conservative — a blob 16 px across goes unshaded where a slab of the
   * same size would not — but it is preserved exactly here rather than corrected, because this
   * refactor's gate is that it changes no pixels. Noted in TODOS.md as a tuning candidate.
   */
  if (!shadesAt(blob.radius)) return;

  // The lit side of the rosette, on the same principle as a blob's crown: a smaller copy of the
  // plant's own shape shifted towards the light, never a separate highlight laid on top.
  const offset = blob.radius * 0.18;
  context.fillStyle = rgbToCss(shiftBrightness(blob.tone, MODULE_HIGHLIGHT));
  traceBlades(context, blob, blades, 0.6, blob.light.x * offset, blob.light.y * offset);
}

function traceBlades(
  context: PatternContext,
  blob: BlobDraw,
  blades: { angle: number; reach: number }[],
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const cx = blob.x + offsetX;
  const cy = blob.y + offsetY;

  for (const blade of blades) {
    const reach = blade.reach * scale;
    const tipX = cx + Math.cos(blade.angle) * reach;
    const tipY = cy + Math.sin(blade.angle) * reach;

    // Half the leaf's width at its base, perpendicular to its own axis. Narrower than this and
    // the tuft reads as a starburst rather than as a plant; wider and the blades merge back into
    // the blob this form exists to escape.
    const width = reach * 0.3;
    const px = -Math.sin(blade.angle) * width;
    const py = Math.cos(blade.angle) * width;

    // Out along one side and back along the other, bowed slightly so the leaf arches.
    context.beginPath();
    context.moveTo(cx + px, cy + py);
    context.quadraticCurveTo(
      cx + px * 0.5 + (tipX - cx) * 0.5,
      cy + py * 0.5 + (tipY - cy) * 0.5,
      tipX,
      tipY,
    );
    context.quadraticCurveTo(
      cx - px * 0.5 + (tipX - cx) * 0.5,
      cy - py * 0.5 + (tipY - cy) * 0.5,
      cx - px,
      cy - py,
    );
    context.closePath();
    context.fill();
  }
}

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
