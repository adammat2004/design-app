import {
  bondFor,
  bondOffset,
  boundingBox,
  MM_PER_METRE,
  scatterForm,
  waterSurface,
  type DesignElement,
  type MaterialPattern,
  type PlantingLayer,
  type Point,
} from '@garden-studio/schema';
import {
  cssToRgb,
  LIGHT_DIRECTION,
  MODULE_BEVEL_RATIO,
  MODULE_HIGHLIGHT,
  MODULE_SHADOW,
  hexToRgb,
  rgbToCss,
  shiftBrightness,
} from './light';
import { edgeFor, type MaterialManifestEntry } from './palette';
import { layerSeed, resolveLayers } from './layers';
import { samplePlanting } from './planting/sample';
import { tintSprites } from './sprite-tint';
import {
  MIN_CUT_EDGE_PX,
  MIN_DRAWN_MODULE_PX,
  MIN_TEXTURED_TILE_PX,
  shadesAt,
  tierFor,
  type DetailTier,
} from './lod';
import { moduleRandom, pick } from './prng';
import { ASSET_FAMILIES, type AssetId } from './assets/asset-spec';
import {
  CONTACT_SHADOW_SPRITE,
  MATERIAL_ASSETS,
  type MaterialAssetSpec,
} from './assets/material-assets';
import { assetsMatching } from './assets/taxonomy';
import type { AssetImage, AssetLookup, LoadedAsset } from './assets/registry';
import { CONTACT_SHADOW_ALPHA, CONTACT_SHADOW_OFFSET_RATIO, CONTACT_SHADOW_SCALE } from './light';

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
 * The column index a course's own randomness is drawn from.
 *
 * `moduleRandom` is keyed on a cell, and a course needs a generator that belongs to the *row* and
 * not to any cell in it — otherwise every module in the row would have to agree on which of them
 * spoke for it. A reserved column far outside any real sweep gives the row its own stream while
 * reusing the spatial hash the rest of the renderer depends on.
 */
const COURSE_HASH_COL = -99991;

/** How strongly the water photograph shows over the body colour that decides pond from pool. */
const WATER_TEXTURE_ALPHA = 0.6;

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
  /**
   * Images arrived with the asset pipeline: a face per slab, a tile of gravel, a shrub. Both
   * forms are used — the nine-argument one samples a strip of a board's grain, the five-argument
   * one places a tile or a sprite. `globalAlpha` composites the water texture over its body and
   * the contact shadow under a sprite; `globalCompositeOperation` multiplies the mown stripes over
   * the turf photo. All present on both contexts, for the same reason `strokeStyle` is.
   */
  drawImage(image: AssetImage, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: AssetImage,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  globalAlpha: number;
  globalCompositeOperation: string;
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
  /**
   * The loaded images, by family. Absent — or answering an empty list — means the painter draws
   * what it drew before assets existed, so a plan is never blank while the files are on their way.
   * A function rather than the registry itself, so the tests can hand in exactly the images a case
   * needs and the painter stays a pure function of its arguments.
   */
  assets?: AssetLookup;
  /**
   * A ceiling on the detail this pass will draw, whatever the zoom would otherwise warrant.
   *
   * The one caller is a live drag or resize. While a gesture is running the surface's outline
   * changes on every frame, so its cache key changes on every frame, so it is fully repainted on
   * every frame *and* it fills the cache with entries that are already dead — evicting the static
   * surfaces still on screen. Capping the tier makes those frames nearly free, and the surface
   * snaps back to full detail the moment the gesture ends.
   *
   * `'mass'` rather than a flat fill on purpose: the surface keeps its own averaged tone, so a
   * lawn stays green and a patio stays stone-coloured while it moves. And it reuses the vocabulary
   * `lod.ts` already has rather than inventing a second way to say the same thing.
   */
  maxTier?: DetailTier;
  /**
   * A canvas factory, so a painter that needs a scratch surface can have one.
   *
   * `RenderPass` requires it — it has to allocate the raster itself. Here it is optional because
   * `drawSurfacePattern` can be handed a context directly, by the composer and by the tests.
   * Absent means the one thing that needs it, tinting plant sprites towards their palette, is
   * skipped and the photographs draw as they are: plainer, never broken, which is the same rule a
   * missing asset file follows.
   */
  makeCanvas?: MakeCanvas;
  /**
   * The line this surface runs along, when it has one — a polyline's own points, from
   * `elementCentreline`.
   *
   * Strictly per-surface rather than per-pass, which is what `DrawPass` is otherwise for, and it
   * sits here anyway because the alternative is a ninth positional argument on a function that
   * already takes seven. Only `pads` reads it, and only a polyline ever has one; absent, a pad run
   * falls back to the shape's bounding box, which is what a stepping-stone *polygon* should get.
   */
  centreline?: Point[];
  /**
   * The element being drawn, for the little that is decided per element rather than per material.
   *
   * Only `plantingStyle` is read, and only by `resolveLayers` — a bed's scheme is a property of the
   * bed, not of `planting-bed` as a material, so two borders in one garden can be planted
   * differently. Narrow on purpose: widening this to the whole element would make it a back door
   * into the renderer for anything, and the reason `DrawPass` is a plain value object is that
   * everything below it stays a pure function of its arguments.
   */
  element?: Pick<DesignElement, 'plantingStyle' | 'category'>;
}

/** Whichever of the two is coarser. `detail` is the ceiling that changes nothing. */
function cappedTier(tier: DetailTier, ceiling: DetailTier | undefined): DetailTier {
  if (!ceiling) return tier;

  const order: DetailTier[] = ['mass', 'units', 'detail'];
  return order.indexOf(ceiling) < order.indexOf(tier) ? ceiling : tier;
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

  drawSurfacePattern(
    context,
    outline,
    material,
    anchor,
    seed,
    {
      pxPerMetre: scale,
      light: pass.light,
      assets: pass.assets,
      makeCanvas,
      centreline: pass.centreline,
    },
    originMetres,
  );

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

  if (cappedTier(tierFor(material.pattern, pxPerMetre), pass.maxTier) === 'mass') {
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
  context.save();
  context.translate(originPx.x, originPx.y);
  context.rotate((rotation * Math.PI) / 180);

  /*
   * The stack, painted in order. A surface used to be one pattern and one `paint()` call; it is a
   * list now because everything that reads as a designed garden is layered — soil under planting,
   * mow stripes over turf, an edging course round paving.
   *
   * `resolveLayers` returns a single entry today, so this loop runs exactly once with exactly the
   * arguments the single call used to take. That is the point: the plumbing lands first, gated on
   * the byte-identical test, and the stacks arrive one material at a time afterwards.
   */
  const layers = resolveLayers(material, pass.element);

  for (let i = 0; i < layers.length; i += 1) {
    const { entry: layer, assets: override } = layers[i]!;

    /*
     * Layer 0's tier was already decided by the gate above, which is the one allowed to paint a
     * flat wash — it is the ground. A *later* layer that has fallen below its own detail floor is
     * skipped instead, because filling its averaged tone across the surface would erase everything
     * under it: a bed zoomed out would become a sheet of leaf-green rather than soil with planting
     * on it that is too small to resolve.
     */
    if (i > 0 && cappedTier(tierFor(layer.pattern, pxPerMetre), pass.maxTier) === 'mass') continue;

    // Per layer, not per surface: each layer draws with its own sprites and its own texture.
    const assets = resolveAssets(layer, pass.assets, pxPerMetre, pass.makeCanvas, override);

    paint(
      context,
      layer,
      outline,
      origin,
      rotation,
      layerSeed(seed, i),
      pxPerMetre,
      light,
      assets,
      pass.centreline,
      layers[i]!.planting,
    );
  }

  /*
   * Back to raster space for the edge, with the clip still in force. The edge was once stroked
   * inside pattern space with raster coordinates, which displaced it by the pattern origin — off
   * the raster entirely for a surface far from the plan origin, so nobody saw it, and a metre
   * inside the outline when a whole plan was drawn with a margin, where it showed as a stray arc.
   */
  context.restore();

  drawCutEdge(context, material, outline, pxPerMetre, toPx);

  context.restore();
}

/* ---------------------------------------------------------------- assets */

/**
 * The images one surface may draw with, already looked up.
 *
 * Resolved once per surface rather than per unit, like the palette check in `resolvePattern`: a
 * scatter draws thousands of units and the lookup is the same for every one of them. Every list
 * is empty when the file was never generated, never loaded, or would be too small to read at this
 * zoom — and an empty list is what sends each painter down the path it took before this existed.
 */
interface SurfaceAssets {
  texture: LoadedAsset | null;
  /** Ground covered by one texture tile, in pattern-space pixels. */
  tilePx: { w: number; h: number };
  /**
   * Whether the texture *is* the surface — gravel, bark, chippings — rather than the ground its
   * units sit on. Decided by the manifest, not by what has loaded: a bed whose plant sprites are
   * still on their way is a bed of drawn blobs on soil, not a bed of bare soil.
   */
  textureIsMass: boolean;
  faces: LoadedAsset[];
  /** Sprite variants per family, flattened: the scatter picks one by seed. */
  sprites: LoadedAsset[];
  flowers: { sprites: LoadedAsset[]; share: number } | null;
  shadow: LoadedAsset | null;
}

const NO_ASSETS: SurfaceAssets = {
  texture: null,
  tilePx: { w: 0, h: 0 },
  textureIsMass: false,
  faces: [],
  sprites: [],
  flowers: null,
  shadow: null,
};

function resolveAssets(
  material: MaterialManifestEntry,
  lookup: AssetLookup | undefined,
  pxPerMetre: number,
  makeCanvas?: MakeCanvas,
  /**
   * This layer's own assets, in place of the material's.
   *
   * A planting bed's layers each want a different family — shrubs at the back, ground cover at the
   * front — and they are all drawn on one element, so the material id cannot answer for them.
   * Absent is every other surface, which takes the material's own.
   */
  override?: MaterialAssetSpec,
): SurfaceAssets {
  const spec = override ?? MATERIAL_ASSETS[material.id];
  const wanted = spec
    ? {
        face: spec.face,
        texture: spec.texture,
        sprites: spec.sprites ? assetsMatching(spec.sprites) : undefined,
        flowers: spec.flowers,
      }
    : null;
  if (!lookup || !wanted) return NO_ASSETS;

  const first = (id: AssetId | undefined): LoadedAsset | null =>
    id ? (lookup(id)[0] ?? null) : null;
  const all = (ids: AssetId[] | undefined): LoadedAsset[] =>
    ids ? ids.flatMap((id) => lookup(id)) : [];

  let texture = first(wanted.texture);
  let tilePx = { w: 0, h: 0 };

  if (texture) {
    const { metres } = ASSET_FAMILIES[texture.entry.id];
    tilePx = { w: metres.w * pxPerMetre, h: metres.h * pxPerMetre };
    // A tile a few pixels across is noise, not gravel; the flat tone underneath reads better.
    if (Math.min(tilePx.w, tilePx.h) < MIN_TEXTURED_TILE_PX) texture = null;
  }

  const flowerSprites = wanted.flowers ? lookup(wanted.flowers.sprite) : [];

  return {
    texture,
    tilePx,
    textureIsMass: wanted.sprites === undefined,
    faces: all(wanted.face ? [wanted.face] : undefined),
    /*
     * Tinted towards the material's own palette. Without this the palette does not reach a bed
     * that has sprites at all, and a hedge, a shrub bed and a ground cover are three photographs
     * of very nearly the same green — see `sprite-tint.ts`. Done here, once per surface, rather
     * than in the unit loop, which draws thousands of them.
     */
    sprites: tintSprites(all(wanted.sprites), material.palette, makeCanvas),
    flowers:
      wanted.flowers && flowerSprites.length > 0
        ? // Flowers are the accent *against* the foliage, so they keep their own colour.
          { sprites: flowerSprites, share: wanted.flowers.share }
        : null,
    shadow: first(CONTACT_SHADOW_SPRITE),
  };
}

/**
 * Tiles a texture across the outline's extent, in pattern space.
 *
 * Tiles are indexed from the pattern origin by the same `gridRange` the modules use, which is the
 * whole of world-space continuity for textures: two abutting patios compute the same tile for the
 * same patch of ground. Each tile is drawn a pixel wide of its cell so that resampling at a
 * fractional position cannot leave a hairline of the ground showing between neighbours.
 */
function tileTexture(
  context: PatternContext,
  texture: LoadedAsset,
  tilePx: { w: number; h: number },
  outline: Point[],
  origin: Point,
  rotation: number,
  pxPerMetre: number,
  alpha = 1,
): void {
  const tileW = tilePx.w / pxPerMetre;
  const tileH = tilePx.h / pxPerMetre;
  const range = gridRange(outline, origin, rotation, tileW, tileH);

  const tiles = (range.maxCol - range.minCol + 1) * (range.maxRow - range.minRow + 1);
  if (tiles > MAX_SCATTER_UNITS) return;

  context.globalAlpha = alpha;
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      context.drawImage(texture.image, col * tilePx.w, row * tilePx.h, tilePx.w + 1, tilePx.h + 1);
    }
  }
  context.globalAlpha = 1;
}

/**
 * One sprite, centred at a point, turned, and standing on its contact shadow.
 *
 * The shadow is a drawing convention, not a solar claim: proportional to the sprite, pushed a
 * little way *away* from the light the pass is lit by, never scaled by any height. It says "this
 * stands up off the ground", which a plan symbol needs to say whether or not the plan knows where
 * on Earth it is. The cast-shadow layer — the one that says where the shade falls at four
 * o'clock — stays gated on `site.location`.
 */
function drawSprite(
  context: PatternContext,
  sprite: LoadedAsset,
  shadow: LoadedAsset | null,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  light: Point,
): void {
  if (shadow) {
    const reach = radius * CONTACT_SHADOW_SCALE;
    const offset = radius * CONTACT_SHADOW_OFFSET_RATIO;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    context.drawImage(
      shadow.image,
      x - light.x * offset - reach,
      y - light.y * offset - reach,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  // Fitted inside the unit's circle: the sprite's longer side spans the diameter.
  const { width, height } = sprite.image;
  const scale = (radius * 2) / Math.max(width, height);

  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.drawImage(
    sprite.image,
    (-width * scale) / 2,
    (-height * scale) / 2,
    width * scale,
    height * scale,
  );
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
  assets: SurfaceAssets,
  /** The polyline this surface runs along, when it has one. Only `pads` reads it. */
  centreline?: Point[],
  /** The scheme layer this is, when it is one. Only `scatter` reads it. */
  planting?: PlantingLayer,
): void {
  const { pattern } = material;

  switch (pattern.patternType) {
    case 'grid':
    case 'board':
      paintModules(
        context,
        material,
        pattern,
        outline,
        origin,
        rotation,
        seed,
        pxPerMetre,
        light,
        assets,
      );
      return;
    case 'scatter':
      paintScatter(
        context,
        material,
        pattern,
        outline,
        origin,
        rotation,
        seed,
        pxPerMetre,
        light,
        assets,
        planting,
      );
      return;
    case 'hedge':
      paintHedgeRun(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, light, assets, centreline);
      return;
    case 'pads':
      paintPads(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, light, assets, centreline);
      return;
    case 'water':
      paintWater(
        context,
        material,
        pattern,
        outline,
        origin,
        rotation,
        seed,
        pxPerMetre,
        light,
        assets,
      );
      return;
    case 'stripe':
      // Mown stripes are flat bands of one grass catching the light two ways; there is no lit
      // edge to place, so the sun does not reach this branch.
      paintStripes(context, material, pattern, outline, origin, rotation, seed, pxPerMetre, assets);
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

  /*
   * A real width, floored at a legible one.
   *
   * A 30 mm spade cut is 0.8 px at the zoom a whole plan is read at, and this used to give up
   * below a pixel — so the mark that says "this is a bed rather than a patch of the lawn"
   * disappeared at exactly the scale where the distinction matters most, and came back only when
   * you zoomed in far enough not to need it.
   *
   * Flooring rather than scaling is the same decision module shading already makes: an arris is
   * sub-pixel at every zoom the plan supports, so it is drawn as a proportion of its module rather
   * than as its true 10 mm. A cut edge is a drawing convention in that class. What stops this
   * becoming clutter at a far zoom is the tier gate above — a surface that has fallen to `mass`
   * has already returned, so a bed too small to draw its planting draws no edge either.
   */
  const widthPx = Math.max((edge.widthMm / MM_PER_METRE) * pxPerMetre, MIN_CUT_EDGE_PX);

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
  assets: SurfaceAssets,
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
   * The photographed surface over the body colour, not instead of it. The palette still decides
   * whether this is a green pond or a blue pool — the two are the same tile at different tints —
   * and the crests below still catch the sun on the lit side.
   */
  if (assets.texture) {
    tileTexture(
      context,
      assets.texture,
      assets.tilePx,
      outline,
      origin,
      rotation,
      pxPerMetre,
      WATER_TEXTURE_ALPHA,
    );
  }

  const surface = waterSurface(pattern);

  /*
   * What sort of water this is, beyond how fast it moves.
   *
   * All four water materials used to resolve to a body colour and a ripple spacing, and two of
   * them — a formal pool and a water bowl — are both perfectly still, so they came out identical.
   * All four also share one photograph. These are the marks that tell them apart, and each is the
   * thing a designer would actually point at.
   */
  if (surface === 'still') {
    /*
     * A vessel. No horizon to reflect and nothing growing, so the only mark is the meniscus: a
     * bright rim where the water meets the lip. Stroked on the clipped outline, so only its inner
     * half renders — the same trick `drawCutEdge` uses, and the reason no inset polygon is needed.
     */
    const rim = Math.max(1, Math.min(width, height) * 0.06);
    traceInPattern(context, outline, origin, pxPerMetre);
    context.lineWidth = rim * 2;
    context.strokeStyle = rgbToCss(shiftBrightness(body, MODULE_HIGHLIGHT * 1.4));
    context.stroke();
    return;
  }

  if (surface === 'planted') {
    /*
     * A pond's margins. Marginal planting is what makes a pond a pond rather than a tank, and in
     * plan it reads as a soft dark band round the inside of the water — irises, rushes, whatever
     * is standing in the shallows. Same clipped-stroke trick as the rim above.
     */
    const margin = Math.max(2, Math.min(width, height) * 0.14);
    traceInPattern(context, outline, origin, pxPerMetre);
    context.lineWidth = margin * 2;
    context.strokeStyle = rgbToCss(shiftBrightness(body, -MODULE_SHADOW * 2.4));
    context.stroke();
  }

  if (surface === 'reflective') {
    /*
     * A mirror holds the sky, and in plan that is two or three long straight streaks running the
     * length of the pool — not the broken crests moving water gets. Straightness is the whole
     * distinction: a crest is where the surface is disturbed, and this surface is not.
     *
     * Deliberately *not* the broad rectangular sheen the first water renderer drew. That read as a
     * UI panel laid on the water, and a bright patch in the middle of a pool is not how water is
     * drawn in plan anyway.
     */
    const streakRandom = moduleRandom(seed, 0, 0);
    const along = height > width;
    const span = along ? height : width;
    const across = along ? width : height;

    for (let i = 0; i < 3; i += 1) {
      const at = across * (0.22 + i * 0.26 + streakRandom() * 0.06);
      const start = span * (0.12 + streakRandom() * 0.2);
      const run = span * (0.4 + streakRandom() * 0.3);
      const thickness = Math.max(1, across * 0.02);

      context.fillStyle = rgbToCss(shiftBrightness(body, MODULE_HIGHLIGHT * 1.1));
      if (along) context.fillRect(left + at, top + start, thickness, run);
      else context.fillRect(left + start, top + at, run, thickness);
    }
    return;
  }

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
  assets: SurfaceAssets,
): void {
  const moduleWidth = pattern.moduleSize.w / MM_PER_METRE;
  const moduleHeight = pattern.moduleSize.h / MM_PER_METRE;
  const joint = pattern.jointWidth / MM_PER_METRE;
  const pitchX = moduleWidth + joint;
  const pitchY = moduleHeight + joint;

  // Stepping stones sit in lawn: the ground between modules is a texture, when there is one.
  if (assets.texture) {
    tileTexture(context, assets.texture, assets.tilePx, outline, origin, rotation, pxPerMetre);
  }

  /*
   * The bond: how far each course is offset from the one before.
   *
   * This used to be one number — half a module for boards, nothing for everything else — so every
   * slab material was laid stack bond with its joints running continuously in both directions.
   * That is the visual signature of a tiled wall, and it is most of why a patio here read as a
   * bathroom floor rather than as something laid on the ground.
   *
   * `bondFor` resolves the manifest's optional field, so a material that says nothing draws
   * exactly what it drew before: `stack` for a grid, `running` for a board.
   */
  const bond = bondFor(pattern);

  const modulePx = Math.min(moduleWidth, moduleHeight) * pxPerMetre;
  const shaded = shadesAt(modulePx);
  // At least a whole pixel, or the bevel is drawn at a fraction of one and simply does not appear.
  const bevel = Math.max(1, Math.round(modulePx * MODULE_BEVEL_RATIO));

  const range = gridRange(outline, origin, rotation, pitchX, pitchY);
  /*
   * An offset course reaches a whole module further left than its own column bounds suggest, so
   * the sweep starts one column early. One is enough for every bond: the offsets are all a
   * fraction of a single pitch.
   */
  const minCol = bond === 'stack' ? range.minCol : range.minCol - 1;

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    /*
     * Seeded from the *row index*, not from the sweep. The row index comes from the pattern
     * origin, so a random bond survives a vertex drag unchanged and — the load-bearing half — two
     * abutting patios share the row index and therefore take the same offset, which is what keeps
     * their courses running through the shared edge.
     */
    const offset = bondOffset(bond, row, moduleRandom(seed, COURSE_HASH_COL, row)) * pitchX;

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
        faces: assets.faces,
        grainAlong: pattern.patternType === 'board',
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
  /** Photographed surfaces to choose between. Empty means the flat tone, as before. */
  faces: LoadedAsset[];
  /** Boards keep their grain along the module; slabs may be turned a quarter. */
  grainAlong: boolean;
}

/**
 * How far a module is pulled towards its palette tone over the face photograph.
 *
 * **A multiply, at a low strength — and the two halves of that go together.**
 *
 * It was a translucent wash, on the reasoning that multiplying by a mid-grey darkens every slab by
 * a fixed ratio and drags the patio towards mud. That reasoning was half right and it cost the
 * thing the palette exists for: a wash moves *every* module the same distance towards its tone, so
 * the per-module jitter was averaged away and a patio came out as one flat printed sheet. Multiply
 * is proportional — a light tone barely touches the photograph, a dark one bites — so the palette's
 * spread survives onto the faces and neighbouring slabs differ the way stone from one batch does.
 *
 * The muddying is real, which is what the strength is for. At 0.28 the multiply visibly darkened
 * and saturated the timber materials, whose tones are strong browns; 0.16 keeps the proportionality
 * and leaves the photographs looking like photographs. (Note a low-alpha multiply is algebraically
 * a multiply by a tone pre-blended towards white, so there is nothing to gain by writing it that
 * way instead.)
 */
const FACE_TINT = 0.16;

/**
 * How far a mass texture — an aggregate, whose photograph *is* the surface — is carried towards its
 * palette.
 *
 * Stronger than `FACE_TINT`, because it is doing more work. A slab's tone is one of several draws
 * that decide how it looks; an aggregate has nothing else at all, so this is the only place its
 * palette is heard, and at a slab's strength the four aggregates stayed four photographs.
 */
const MASS_TEXTURE_TINT = 0.34;

function drawModule(context: PatternContext, module: ModuleDraw): void {
  const random = moduleRandom(module.seed, module.col, module.row);

  const base = hexToRgb(pick(module.palette, random()));
  // Symmetric about zero, so jitter varies a tone rather than systematically darkening the surface.
  const tone = shiftBrightness(base, (random() * 2 - 1) * TONE_JITTER);

  context.fillStyle = rgbToCss(tone);
  context.fillRect(module.x, module.y, module.width, module.height);

  /*
   * The face, drawn after the tone the module already had. Its variant, its quarter-turn and the
   * run of grain it shows are three more draws from the *same* per-module generator, so a slab
   * keeps its face across every re-clip — the property that makes a vertex drag repaint only the
   * modules that moved. Drawn after the first two draws above, so a surface with no faces produces
   * exactly the pixels it did before faces existed.
   */
  if (module.faces.length > 0) {
    const face = pick(module.faces, random());
    const turns = module.grainAlong ? 0 : Math.floor(random() * 4);
    const along = random();
    drawFace(context, face.image, module, turns, along);

    /*
     * Multiplied rather than washed over.
     *
     * A flat alpha wash moves every slab the same distance towards its tone, so the per-module
     * tonal variation the palette exists to give was being averaged away — every slab in a patio
     * came out the same value, and the surface read as one printed sheet. Multiply is
     * *proportional*: a light tone barely darkens the photograph and a dark one darkens it a lot,
     * so the palette's spread survives onto the face and adjacent slabs differ the way real stone
     * from one batch differs.
     *
     * Confined to the module's own rectangle, which the face has just been drawn into, so nothing
     * underneath is affected. Inside the `faces.length > 0` branch, so a surface with no assets
     * still produces exactly the pixels it did before faces existed.
     */
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = FACE_TINT;
    context.fillStyle = rgbToCss(tone);
    context.fillRect(module.x, module.y, module.width, module.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

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

/**
 * Paints a face photograph into a module.
 *
 * The source is cropped to the module's own aspect, so a 900 × 600 slab shows a 3:2 window of the
 * square photograph rather than a squashed one, and a board — whose aspect no photograph could be
 * generated at — shows a strip of grain, taken from a seeded height so no two boards show the
 * same run. Turned by whole quarters only: a photograph rotated 30° inside an axis-aligned slab
 * would show its corners.
 */
function drawFace(
  context: PatternContext,
  image: AssetImage,
  module: ModuleDraw,
  turns: number,
  along: number,
): void {
  const turned = turns % 2 === 1;
  const targetW = turned ? module.height : module.width;
  const targetH = turned ? module.width : module.height;
  const aspect = targetW / targetH;

  let sw = image.width;
  let sh = image.width / aspect;
  if (sh > image.height) {
    sh = image.height;
    sw = image.height * aspect;
  }
  const sx = (image.width - sw) * (module.grainAlong ? 0 : along);
  const sy = (image.height - sh) * along;

  if (turns === 0) {
    context.drawImage(image, sx, sy, sw, sh, module.x, module.y, module.width, module.height);
    return;
  }

  context.save();
  context.translate(module.x + module.width / 2, module.y + module.height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(image, sx, sy, sw, sh, -targetW / 2, -targetH / 2, targetW, targetH);
  context.restore();
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
  assets: SurfaceAssets,
  /** The scheme layer this is, when it is one. Present replaces the even grid with the sampler. */
  planting?: PlantingLayer,
): void {
  const form = scatterForm(pattern);

  /*
   * The ground first: soil under a bed, and for an aggregate the whole thing. Gravel is a mass of
   * the same stuff — CLAUDE.md's argument for drawing its background from its own palette — and
   * once that mass is a photograph there is nothing left for the unit loop to add, so it returns.
   * Planting keeps the loop: a shrub is a thing sitting *on* the soil.
   */
  if (assets.texture) {
    if (form === 'clipped-mass') {
      paintClippedMass(context, pattern, outline, origin, rotation, seed, pxPerMetre, assets);
      return;
    }

    tileTexture(context, assets.texture, assets.tilePx, outline, origin, rotation, pxPerMetre);

    if (assets.textureIsMass) {
      /*
       * A mass texture *is* the surface, so nothing else is drawn over it — which meant the
       * palette never reached an aggregate at all. Bark, play bark, decorative gravel and slate
       * chippings each resolved to one photograph and the tones in `MATERIAL_TONES` were dead
       * letters: widening their spread changed the blob fallback and nothing a user ever sees.
       *
       * Exactly the defect the plant sprites had, and the same fix. Multiplied rather than washed,
       * for the reason `FACE_TINT` gives: proportional, so a pale gravel keeps its brightness while
       * a dark slate is carried where its palette says. This is what stopped a bed of slate
       * chippings reading as a pool of water.
       */
      tintSurface(context, outline, origin, pxPerMetre, averageTone(material.palette));
      return;
    }
  }

  /*
   * A jittered grid, not true Poisson-disc sampling.
   *
   * One cell holds one unit, placed somewhere inside it by the cell's own generator. That is what
   * makes the scatter deterministic *per cell* — exactly the property `moduleRandom` gives slabs,
   * and the reason re-clipping a bed after a vertex drag cannot reshuffle the plants that did not
   * move. Poisson sampling is prettier and sequential, and sequential is precisely what would make
   * the whole bed repaint every time its outline changed.
   */
  const minSize = pattern.sizeRange.min / MM_PER_METRE;
  const maxSize = pattern.sizeRange.max / MM_PER_METRE;

  /*
   * A planting layer places its units with the sampler; everything else keeps the even grid.
   *
   * The grid is right for what it was built for — gravel, bark, a hedge — where the units *are*
   * evenly spread and the only question is where each one sits inside its cell. It is exactly
   * wrong for a border, where an even spread is the thing that makes a bed read as bedding-out.
   * The sampler adds the three things a border needs and the grid cannot express: drifts, a front
   * to back grade, and a share that thins a layer rather than spacing it further apart.
   */
  if (planting) {
    paintPlantingLayer(
      context,
      material,
      planting,
      outline,
      origin,
      rotation,
      seed,
      pxPerMetre,
      light,
      assets,
      { form, lobes: pattern.lobes, minSize, maxSize },
    );
    return;
  }

  const cell = 1 / Math.sqrt(pattern.density);
  const range = gridRange(outline, origin, rotation, cell, cell);

  const cells = (range.maxCol - range.minCol + 1) * (range.maxRow - range.minRow + 1);
  if (cells > MAX_SCATTER_UNITS) return;

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

      /*
       * A sprite where there is one. Its variant and its turn are two further draws from the same
       * per-cell generator, after the four the blob path makes, so a bed without sprites draws
       * exactly what it always did and a bed with them keeps every plant where it was.
       */
      if (assets.sprites.length > 0) {
        const sprite = pick(assets.sprites, random());
        const turn = random() * Math.PI * 2;
        const radius = (size / 2) * pxPerMetre;
        const x = centreX * pxPerMetre;
        const y = centreY * pxPerMetre;

        drawSprite(context, sprite, assets.shadow, x, y, radius, turn, light);

        if (assets.flowers && random() < assets.flowers.share) {
          const flower = pick(assets.flowers.sprites, random());
          drawSprite(context, flower, null, x, y, radius * 0.55, random() * Math.PI * 2, light);
        }
        continue;
      }

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

/**
 * A clipped hedge with a photographed top.
 *
 * Shape from geometry, fill from texture. Every unit's scalloped outline is traced into one path
 * and used as a clip, so the hedge keeps the defined, slightly lobed edge the `clipped-mass` form
 * exists to give it, and the leaves inside come from the tile. The units are placed by exactly the
 * draws the blob path makes, in the same order, so the hedge's outline is the one it had before.
 */
function paintClippedMass(
  context: PatternContext,
  pattern: Extract<MaterialPattern, { patternType: 'scatter' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  assets: SurfaceAssets,
): void {
  if (!assets.texture) return;

  const cell = 1 / Math.sqrt(pattern.density);
  const range = gridRange(outline, origin, rotation, cell, cell);
  const cells = (range.maxCol - range.minCol + 1) * (range.maxRow - range.minRow + 1);
  if (cells > MAX_SCATTER_UNITS) return;

  const minSize = pattern.sizeRange.min / MM_PER_METRE;
  const maxSize = pattern.sizeRange.max / MM_PER_METRE;

  context.save();
  context.beginPath();

  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const random = moduleRandom(seed, col, row);
      random(); // the tone, unused here but drawn so the positions match the blob path
      random(); // the jitter
      const size = minSize + random() * (maxSize - minSize);
      const centreX = (col + random()) * cell;
      const centreY = (row + random()) * cell;

      const reaches: number[] = [];
      const radius = (size / 2) * pxPerMetre;
      for (let i = 0; i < pattern.lobes; i += 1) {
        reaches.push(radius * (0.92 + random() * 0.14));
      }

      traceBlob(
        context,
        { x: centreX * pxPerMetre, y: centreY * pxPerMetre, radius, lobes: pattern.lobes },
        reaches,
        1,
        0,
        0,
        false,
      );
    }
  }

  context.clip();
  tileTexture(context, assets.texture, assets.tilePx, outline, origin, rotation, pxPerMetre);
  context.restore();
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
  blob: Pick<BlobDraw, 'x' | 'y' | 'radius' | 'lobes'>,
  reaches: number[],
  scale: number,
  offsetX: number,
  offsetY: number,
  /** False to add this blob as a subpath of a path already begun — the hedge's clip. */
  begin = true,
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

  if (begin) context.beginPath();

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
  assets: SurfaceAssets,
): void {
  const band = pattern.bandWidth / MM_PER_METRE;

  // The grass itself, when it is a photograph; the bands are then laid over it as shading.
  if (assets.texture) {
    tileTexture(context, assets.texture, assets.tilePx, outline, origin, rotation, pxPerMetre);
  }

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
    /*
     * Seeded from the *material*, not the surface. A lawn is one continuous ground that the
     * zones merely cut up, so two zones' base fills must jitter each band identically or the seam
     * between them shows as a step in tone — which, over a photograph, it very much did.
     */
    const random = moduleRandom(material.id, 0, row);

    // Alternating, so the mower reads as having gone up and back rather than in one direction.
    const base = hexToRgb(material.palette[Math.abs(row) % material.palette.length]!);
    const tone = shiftBrightness(base, (random() * 2 - 1) * TONE_JITTER);

    if (assets.texture) {
      /*
       * Over a photograph a band is a *difference*, not a colour: the mower flattens the grass one
       * way and it catches the light differently. Multiplying by the band's tone relative to the
       * lightest in the palette darkens the "away" stripes by the same ratio the flat lawn used,
       * and leaves the "towards" stripes as the photograph.
       */
      const lightest = hexToRgb(material.palette[0]!);
      const ratio = Math.min(
        1,
        (tone.r + tone.g + tone.b) / (lightest.r + lightest.g + lightest.b),
      );
      const grey = Math.round(ratio * 255);
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = rgbToCss({ r: grey, g: grey, b: grey });
      context.fillRect(-span, row * band * pxPerMetre, span * 2, band * pxPerMetre);
      context.globalCompositeOperation = 'source-over';
      continue;
    }

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


/**
 * Traces an outline in **pattern space**, where the painters work.
 *
 * The context has already been translated to the pattern origin and rotated, so a world point maps
 * to `(world - origin) * pxPerMetre`. The water painter needs this to stroke a pond's margin or a
 * bowl's rim against the shape's real edge — everything else in that painter works from the
 * bounding box, which is why it did not exist before.
 */
function traceInPattern(
  context: PatternContext,
  outline: Point[],
  origin: Point,
  pxPerMetre: number,
): void {
  /*
   * No rotation term, and that is not an oversight — it was written in once and it was a bug.
   * `drawSurfacePattern` has already translated to the pattern origin *and rotated* before any
   * painter runs, so the context applies the turn itself. Rotating the points as well turns them
   * twice, and a clip built that way lands somewhere off the shape entirely: the fill it guards
   * silently does nothing, which is exactly how it presents.
   */
  context.beginPath();
  outline.forEach((point, index) => {
    const x = (point.x - origin.x) * pxPerMetre;
    const y = (point.y - origin.y) * pxPerMetre;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}


/**
 * Pads set in single file along a path.
 *
 * The replacement for laying stepping stones as a grid. A grid lines its units up in *both*
 * directions, so on a path a metre and a half wide it produced two columns with grass down the
 * middle, and every path the generator drew read as a ladder. Pads march along the path's own
 * centreline, one abreast, and the strip's width only decides how big they are allowed to be.
 *
 * ## Determinism
 *
 * Distance along the path is the spatial hash here, in place of the grid's cell index. A pad's tone
 * and quarter-turn come from `moduleRandom(seed, padIndex, 0)`, and the index is measured from the
 * path's *start* — so dragging the far end of a path leaves every pad before it untouched, which is
 * the same property `gridRange` gives a surface.
 *
 * Pads are **not** clipped to line up between two abutting paths, and that is correct rather than
 * an omission: two paths that meet are two runs with their own starts, and a stride length that
 * carried across the junction would be a coincidence rather than a design.
 */
function paintPads(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'pads' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  light: Point,
  assets: SurfaceAssets,
  centreline: Point[] | undefined,
): void {
  // The ground the pads sit in — grass, for stepping stones — before anything is laid on it.
  if (assets.texture) {
    tileTexture(context, assets.texture, assets.tilePx, outline, origin, rotation, pxPerMetre);
  }

  const padW = pattern.padSize.w / MM_PER_METRE;
  const padH = pattern.padSize.h / MM_PER_METRE;
  const pitch = padH + pattern.gap / MM_PER_METRE;

  const padPx = Math.min(padW, padH) * pxPerMetre;
  if (padPx < MIN_DRAWN_MODULE_PX) return;

  const shaded = shadesAt(padPx);
  const bevel = Math.max(1, Math.round(padPx * MODULE_BEVEL_RATIO));

  /*
   * Without a centreline there is no path to march along, so the run falls back to the shape's own
   * long axis. That is the honest answer for a stepping-stone *polygon*, which somebody can draw
   * in the editor, and it keeps the painter total.
   */
  const line = centreline && centreline.length >= 2 ? centreline : boxAxis(outline);
  if (line.length < 2) return;

  /*
   * Pattern space is rotated about the pattern origin, and the centreline is in world metres, so
   * every point has to come back through the same transform the rest of the painter works in.
   */
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toPattern = (point: Point): Point => {
    const dx = (point.x - origin.x) * pxPerMetre;
    const dy = (point.y - origin.y) * pxPerMetre;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };

  const path = line.map(toPattern);
  const pitchPx = pitch * pxPerMetre;
  const widthPx = padW * pxPerMetre;
  const heightPx = padH * pxPerMetre;

  let index = 0;
  // Half a pitch in, so a run starts with a whole gap rather than a pad flush against the end.
  let carried = pitchPx / 2;

  for (let segment = 0; segment + 1 < path.length; segment += 1) {
    const from = path[segment]!;
    const to = path[segment + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    const ux = dx / length;
    const uy = dy / length;
    // Pads turn with the path, so a stone on a bend is set square to the way you are walking.
    const heading = Math.atan2(uy, ux);

    for (let along = carried; along < length; along += pitchPx) {
      const random = moduleRandom(seed, index, 0);
      index += 1;

      const base = hexToRgb(pick(material.palette, random()));
      const tone = shiftBrightness(base, (random() * 2 - 1) * TONE_JITTER);

      const cx = from.x + ux * along;
      const cy = from.y + uy * along;

      context.save();
      context.translate(cx, cy);
      context.rotate(heading);

      // Not `module`: Next forbids assigning that identifier anywhere in the bundle.
      const pad: ModuleDraw = {
        light,
        col: index,
        row: 0,
        seed,
        palette: material.palette,
        x: -widthPx / 2,
        y: -heightPx / 2,
        width: widthPx,
        height: heightPx,
        shaded,
        bevel,
        faces: assets.faces,
        grainAlong: false,
      };

      context.fillStyle = rgbToCss(tone);
      drawModule(context, pad);
      context.restore();
    }

    carried = pitchPx - ((length - carried) % pitchPx);
  }
}

/**
 * The long axis of a shape's bounding box, as a two-point line.
 *
 * The fallback for a pad run with no centreline. Crude on purpose: a stepping-stone polygon is an
 * odd thing to draw and the right answer for it is "lay them the long way", not a skeleton.
 */
function boxAxis(outline: Point[]): Point[] {
  const box = boundingBox(outline);
  const midX = box.minX + box.width / 2;
  const midY = box.minY + box.length / 2;

  return box.length >= box.width
    ? [
        { x: midX, y: box.minY },
        { x: midX, y: box.minY + box.length },
      ]
    : [
        { x: box.minX, y: midY },
        { x: box.minX + box.width, y: midY },
      ];
}


/**
 * Carries an already-drawn surface towards a tone, in place.
 *
 * The mass-texture twin of the module face's multiply. Confined to the shape by tracing it and
 * clipping, because unlike a module there is no rectangle to fill — and the context's own clip is
 * to the whole surface, which is exactly what a mass texture covers.
 */
function tintSurface(
  context: PatternContext,
  outline: Point[],
  origin: Point,
  pxPerMetre: number,
  tone: string,
): void {
  const box = boundingBox(outline);

  context.save();
  traceInPattern(context, outline, origin, pxPerMetre);
  context.clip();
  context.globalCompositeOperation = 'multiply';
  context.globalAlpha = MASS_TEXTURE_TINT;
  context.fillStyle = tone;
  // Generously past the shape's own box: the clip decides the extent, this only has to cover it.
  const reach = (Math.hypot(box.width, box.length) + 2) * pxPerMetre;
  context.fillRect(-reach, -reach, reach * 2, reach * 2);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.restore();
}


/** Everything the planting painter needs of the pattern it stands in for. */
interface PlantingDraw {
  form: ReturnType<typeof scatterForm>;
  lobes: number;
  minSize: number;
  maxSize: number;
}

/**
 * One layer of a planting scheme, placed by `samplePlanting`.
 *
 * The drawing is deliberately the same drawing the grid path does — same sprite fitting, same
 * contact shadow, same flower overlay, same blob fallback. Only the *placement* differs, and that
 * is the whole of the change: a border stops being an evenly-spaced field and becomes plants in
 * drifts, graded front to back.
 *
 * Two frames meet here and it is the one thing to be careful about. The sampler works in **world
 * metres**, because its drift noise has to be keyed on the world or a drift would slide when the
 * bed's outline changed. The painter works in **pattern space**, which is translated to the pattern
 * origin and already rotated by the context. So each placement is brought across by the same
 * inverse rotation `paintPads` uses — and getting this wrong is invisible at rotation 0, which is
 * most beds, so it would have survived a long time.
 */
function paintPlantingLayer(
  context: PatternContext,
  material: MaterialManifestEntry,
  layer: PlantingLayer,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  light: Point,
  assets: SurfaceAssets,
  draw: PlantingDraw,
): void {
  const placements = samplePlanting(outline, layer, seed);
  if (placements.length === 0 || placements.length > MAX_SCATTER_UNITS) return;

  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  for (const placement of placements) {
    const dx = (placement.at.x - origin.x) * pxPerMetre;
    const dy = (placement.at.y - origin.y) * pxPerMetre;
    const x = rotation === 0 ? dx : dx * cos - dy * sin;
    const y = rotation === 0 ? dy : dx * sin + dy * cos;

    // Clamped into the pattern's own band, so a scheme cannot ask for a plant the material's
    // manifest says is impossible at this scale.
    const size = Math.min(draw.maxSize, Math.max(draw.minSize, placement.spread));
    const radius = (size / 2) * pxPerMetre;

    if (assets.sprites.length > 0) {
      const sprite = pick(assets.sprites, placement.variant);
      drawSprite(context, sprite, assets.shadow, x, y, radius, placement.rotation, light);

      if (assets.flowers && placement.flower < assets.flowers.share) {
        const flower = pick(assets.flowers.sprites, placement.tone);
        drawSprite(context, flower, null, x, y, radius * 0.55, placement.rotation, light);
      }
      continue;
    }

    /*
     * The blob fallback needs a generator of its own for its lobe shape. Seeded from the
     * placement's own position rather than from a counter, so it stays spatially hashed like
     * everything else — a plant keeps its outline when its neighbours change.
     */
    const random = moduleRandom(`${seed}:blob`, Math.round(placement.at.x * 100), Math.round(placement.at.y * 100));

    drawBlob(context, {
      light,
      form: draw.form,
      x,
      y,
      radius,
      lobes: draw.lobes,
      tone: shiftBrightness(
        hexToRgb(pick(material.palette, placement.tone)),
        (placement.variant * 2 - 1) * TONE_JITTER,
      ),
      random,
    });
  }
}


/**
 * A clipped hedge, as a run rather than a field.
 *
 * ## What was wrong with the scatter
 *
 * `hedging` used to be a scatter with `form: 'clipped-mass'` — blobs on a grid, merged into one
 * path. That has no notion of which way the hedge runs, and every property that makes a hedge look
 * like a hedge is directional: it sits at a stated width, it stops at its ends, and it catches the
 * light along one long side. Without them it drew as camouflage with pale holes in it, which is
 * what a row of shrubs seen from above looks like and is precisely what a clipped hedge is not.
 *
 * ## The run
 *
 * Crowns are placed along the centreline at `pitch`, which is deliberately less than `crownSize` so
 * they overlap into one body. The strip's own width caps the crown radius, so a hedge drawn 0.5 m
 * wide is 0.5 m wide rather than whatever the manifest fancied — the geometry stays the geometry of
 * record, as everywhere else in this renderer.
 *
 * Then two marks that cost almost nothing and do most of the work: the whole body is stroked on the
 * *shaded* long edge, and a lighter line runs along the lit one. A hedge in plan is read by its two
 * long edges, and drawing them is the difference between a hedge and a green sausage.
 *
 * ## Determinism
 *
 * Distance along the run is the spatial hash, exactly as `paintPads` uses it — a crown's tone,
 * variant and wobble come from `moduleRandom(seed, crownIndex, 0)`, measured from the run's start.
 * Extending the far end of a hedge leaves every crown before it untouched.
 */
function paintHedgeRun(
  context: PatternContext,
  material: MaterialManifestEntry,
  pattern: Extract<MaterialPattern, { patternType: 'hedge' }>,
  outline: Point[],
  origin: Point,
  rotation: number,
  seed: string,
  pxPerMetre: number,
  light: Point,
  assets: SurfaceAssets,
  centreline: Point[] | undefined,
): void {
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toPattern = (point: Point): Point => {
    const dx = (point.x - origin.x) * pxPerMetre;
    const dy = (point.y - origin.y) * pxPerMetre;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };

  /*
   * The crown is capped by the strip's own width. `boundingBox` of the outline over-measures a
   * diagonal hedge, so the shorter side is used — which is the width for any hedge that is longer
   * than it is wide, and every hedge is.
   */
  const box = boundingBox(outline);
  const strip = Math.min(box.width, box.length);
  const crownMetres = Math.min(pattern.crownSize / MM_PER_METRE, strip);
  const crown = crownMetres * pxPerMetre;
  const pitchPx = (pattern.pitch / MM_PER_METRE) * pxPerMetre;
  if (crown < 1 || pitchPx < 0.5) return;

  /*
   * One run along the polyline it was given, or several parallel ones across a shape that is not
   * hedge-shaped.
   *
   * A hedge is a run, and on a 6 × 3 m polygon a single run would draw a green line down the middle
   * of a bare rectangle. That is not a hedge either — a wide block of clipped hedging is a real
   * thing (a topiary block, a section of maze) and the way it is actually planted is in rows. So a
   * fill gets rows. It is still directional, which is the whole point of the run: each row keeps
   * its own lit and shaded long edges, where the old scatter had none.
   */
  const lines =
    centreline && centreline.length >= 2 ? [centreline] : boxRuns(outline, crownMetres * 0.8);

  /*
   * `cssToRgb`, not `hexToRgb`: `averageTone` returns a css `rgb(...)` string rather than a hex, so
   * the obvious spelling throws at render time and takes the whole sheet with it.
   */
  const body = cssToRgb(averageTone(material.palette));
  const lit = rgbToCss(shiftBrightness(body, MODULE_HIGHLIGHT * 1.6));
  const shaded = rgbToCss(shiftBrightness(body, -MODULE_SHADOW * 1.4));

  let index = 0;

  for (const line of lines) {
   const path = line.map(toPattern);
   let carried = crown / 2;

   for (let segment = 0; segment + 1 < path.length; segment += 1) {
    const from = path[segment]!;
    const to = path[segment + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    const ux = dx / length;
    const uy = dy / length;
    // The long edges of the run: which side is lit is decided by the same sun as everything else.
    const litSide = -uy * light.x + ux * light.y < 0 ? 1 : -1;

    for (let along = carried; along <= length; along += pitchPx) {
      const random = moduleRandom(`${seed}:hedge`, index, 0);
      index += 1;

      const cx = from.x + ux * along;
      const cy = from.y + uy * along;
      // A little variation along the run, so a long hedge is not a stamped repeat.
      const radius = (crown / 2) * (0.9 + random() * 0.2);

      context.fillStyle = rgbToCss(
        shiftBrightness(body, (random() * 2 - 1) * TONE_JITTER),
      );
      context.beginPath();
      traceCircleAt(context, cx, cy, radius);
      context.fill();

      if (assets.sprites.length > 0) {
        const sprite = pick(assets.sprites, random());
        drawSprite(context, sprite, null, cx, cy, radius, random() * Math.PI * 2, light);
      }

      /*
       * The two long edges. Drawn per crown rather than as one stroked path down the whole run,
       * because the run is a chain of overlapping circles and its true outline is not a polyline —
       * a short arc on each crown accumulates into exactly the edge the eye reads.
       */
      const offset = radius * 0.82;
      context.fillStyle = lit;
      context.fillRect(
        cx - uy * offset * litSide - pitchPx / 2,
        cy + ux * offset * litSide - Math.max(1, radius * 0.09),
        pitchPx,
        Math.max(1, radius * 0.18),
      );
      context.fillStyle = shaded;
      context.fillRect(
        cx + uy * offset * litSide - pitchPx / 2,
        cy - ux * offset * litSide - Math.max(1, radius * 0.09),
        pitchPx,
        Math.max(1, radius * 0.18),
      );
    }

    carried = pitchPx - ((length - carried) % pitchPx);
   }
  }
}

/**
 * Parallel lines across a shape's short axis, for a block of hedging rather than a hedge.
 *
 * The rows a wide polygon is planted in. Spaced at the crown's own reach so they close up into one
 * mass — far enough apart to stay rows, close enough that no soil shows between them.
 */
function boxRuns(outline: Point[], spacing: number): Point[][] {
  const box = boundingBox(outline);
  const alongY = box.length >= box.width;
  const across = alongY ? box.width : box.length;
  const rows = Math.max(1, Math.round(across / Math.max(0.05, spacing)));
  const runs: Point[][] = [];

  for (let i = 0; i < rows; i += 1) {
    const at = ((i + 0.5) / rows) * across;

    runs.push(
      alongY
        ? [
            { x: box.minX + at, y: box.minY },
            { x: box.minX + at, y: box.minY + box.length },
          ]
        : [
            { x: box.minX, y: box.minY + at },
            { x: box.minX + box.width, y: box.minY + at },
          ],
    );
  }

  return runs;
}

/** A circle traced into the current path, centred on pattern-space pixels. */
function traceCircleAt(context: PatternContext, x: number, y: number, radius: number): void {
  const segments = 14;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}
