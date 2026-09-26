import {
  boundingBox,
  elementAnchor,
  elementOutline,
  geometryOutline,
  insetPolygon,
  moduleRandom,
  OPENING_HEIGHTS,
  pick,
  resolvedGates,
  resolveSymbol,
  stepFlight,
  STOREY_HEIGHT,
  streetEdge,
  streetOutward,
  type BoundaryRun,
  type DesignElement,
  type PlanGeometry,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { buildRenderScene, type BuildOptions, type PlanScene } from '../render/build-scene';
import { applyGrade, type GradeTarget } from './grade';
import { ASSET_FAMILIES, type AssetId } from './assets/asset-spec';
import type {
  ExtrusionSource,
  RenderExtrusionNode,
  RenderHouse,
  RenderHouseNode,
  RenderItem,
  RenderNode,
  RenderObjectNode,
  RenderOpening,
  RenderPlant,
  RenderPlantNode,
  RenderScene,
  RenderSurface,
} from '../render/scene';
import { LAYER_ORDER } from '../render/visual-layer';
import { depthOf, extrude, lift, RISE, visibleEdges, type Extrusion } from '../render/projection';
import {
  EAVES_SHADOW_ALPHA,
  EAVES_SHADOW_DEPTH,
  elevatedPlacement,
  FACE_SKIN_TINT,
  FRAME_TONE,
  FRAME_WIDTH,
  GLAZING_TONE,
  MAX_PANE_WIDTH,
  faceFill,
  footBand,
  footBandDepth,
  HOUSE_WALL_TONE,
  liftPx,
  ROOFED_SYMBOLS,
  STRUCTURE_OVERHANG,
  type ElevatedPlacement,
} from './symbols/elevated';
import { ROOF_TONES, type RenderRoof } from '../render/roof';
import { COLOUR } from '../canvas-colours';
import { CATEGORY_COLOURS } from '../concept-colours';
import { materialFill } from '../material-colours';
import {
  BOUNDARY_SKINS,
  ROOF_SKINS,
  canopiesForSymbol,
  CONTACT_SHADOW_SPRITE,
  elevatedFamilyFor,
  HOUSE_WALL_SKIN,
  LIGHT_POOL_SPRITE,
  materialAssets,
  SYMBOL_SPRITES,
} from './assets/material-assets';
import type { AssetImage, LoadedAsset } from './assets/registry';
import { isRecolourable } from './assets/taxonomy';
import { SPRITE_TINT, tintSprite } from './sprite-tint';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  FENCE_SHADE_OPACITY,
  LIGHT_DIRECTION,
  LIGHT_POOL_ALPHA,
  CONVENTIONAL_SHADOW_RATIO,
  MIN_CONTACT_SHADOW_HEIGHT,
  NIGHT_MAX_ALPHA,
  NIGHT_TONE,
  SHADOW_OPACITY,
  SHADOW_TONE,
  cssToRgb,
  rgbToCss,
  shiftBrightness,
} from './light';
import {
  boundaryBand,
  BOUNDARY_PALETTE,
  crownInset,
  inwardNormal,
  MIN_BAND_PX,
  ringIsClockwise,
  runPosts,
} from './symbols/boundary';
import {
  fenceShadeBands,
  gateSwings,
  houseGroundShadow,
  HOUSE_SHADOW_ALPHA,
  openGapTicks,
  STREET_KERB_OFFSET,
  swingGeometry,
  WALL_THICKNESS,
  type SwingGeometry,
} from './symbols/property';
import { MIN_DRAWN_SYMBOL_PX, MIN_DRAWN_UNIT_PX } from './lod';

/**
 * A drift is a couple of metres across, so this is generous — it exists to refuse the pathological
 * case rather than to bound the ordinary one, and a cluster too big to raster draws nothing at all
 * rather than a differently-shaded lump beside its neighbours.
 */
const MAX_MASS_RASTER_PX = 2048;
import { PRESENTATION_SHADOW_SOFTNESS, renderShadowLayer } from './render-shadow-layer';
import { renderSeamLayer, SEAM_SHADE_OPACITY } from './render-seam-layer';
import {
  drawBlob,
  drawSprite,
  drawSurfacePattern,
  renderSurfacePattern,
  type DrawPass,
  type MakeCanvas,
  type PatternCanvas,
  type PatternContext,
} from './render-surface-pattern';
import {
  beamLines,
  canopyCrown,
  canopyRing,
  canopySpriteBox,
  firePitRings,
  MIN_TRUNK_PX,
  trunkAndCanopy,
} from './symbols/canopy';
import { drawSymbol, MIN_STRUCTURE_DETAIL_PX } from './symbols/draw-symbol';
import { RENDER_PASSES, type RenderPrimitive, type RenderPassName } from '../render/primitives';
import { clusterMassOpacity, plantMassOpacity } from '../render/plant-clusters';
import { drawLinearCourse } from './render-linear-course';
import { compileLinearCourse } from '../render/linear-course';

/**
 * A whole plan, drawn into one 2D context.
 *
 * The Konva canvases draw a plan as a tree of React nodes, and for the screen that is right. But
 * four other things need the same picture as pixels — the concept card on step 4, the PNG the user
 * downloads, the judging sheet `render:plan` writes, and later the image a hero render is
 * conditioned on — and each of them drawing its own version is how step 4 came to contradict
 * step 5 the first time. This is the one place the stacking order is written down as code that
 * runs outside React:
 *
 * ```
 *   ground ─▶ fills (base, then accent) ─▶ cast shadows ─▶ features ─▶ house ─▶ fence
 *             └── drawSurfacePattern ──┘    (one layer,      ├── surfaces (same painter)
 *                                            composited       ├── paths
 *                                            once)            └── symbols: trees, fire pits, beams
 * ```
 *
 * It obeys the renderer's one rule: **no authority.** Everything here is handed an outline that
 * `geometryOutline` already produced, and the only decisions it makes are about pixels. Nothing
 * downstream reads what it draws.
 *
 * A context rather than a canvas, for the reason `drawSurfacePattern` takes one: jsdom cannot
 * make a 2D context, so the tests hand in `@napi-rs/canvas` and the browser hands in the DOM's.
 */

/**
 * What is drawn. A subset of the document, in the frame every canvas already uses.
 *
 * Defined with the scene builder, because that is what consumes it now; re-exported here so the
 * four callers that have always imported it from the composer still can.
 */
export type { PlanScene } from '../render/build-scene';

/** The composer needs to composite a layer, which the surface painter never does. */
export interface PlanContext extends PatternContext {
  drawImage(image: PatternCanvas, dx: number, dy: number): void;
  drawImage(image: PatternCanvas, dx: number, dy: number, dw: number, dh: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  lineJoin: string;
  lineCap: string;
  /** Optional: the street's kerb is dashed where the context can, solid where it cannot. */
  setLineDash?(segments: number[]): void;
}

export interface PlanPass extends DrawPass {
  /** For the shadow sub-layer, which must be filled opaque on its own and composited once. */
  makeCanvas: MakeCanvas;
  /** Contact shadows are a shared ground pass in v2. */
  contactShadows?: boolean;
  /** LOD uses CSS pixels; raster density can be higher on Retina displays. */
  lodPxPerMetre?: number;
  plantOpacity?: number;
  massOpacity?: number;
  grade?: boolean;
}

/** A neutral ground for the plot — the same tint the canvases fill the boundary with. */
export const PLOT_GROUND = '#eef3ea';

/** A trunk seen from above: dark, and the same on every tree because bark at 1:100 is one tone. */
const TRUNK_TONE = '#4a3a2c';

/**
 * Draws the scene.
 *
 * `rasterOrigin` is the world point the context's `(0, 0)` is, so a caller can draw a plan with a
 * margin round it (the sheets) or flush (a thumbnail) without this function knowing which.
 */
export function drawPlan(
  context: PlanContext,
  scene: PlanScene,
  pass: PlanPass,
  rasterOrigin: Point,
  options: BuildOptions = {},
): void {
  drawScene(
    context,
    buildRenderScene(scene, { light: pass.light, ...options }),
    scene.site,
    pass,
    rasterOrigin,
  );
}

/**
 * The Canvas2D backend: a resolved scene, put down as pixels.
 *
 * Everything it draws was decided by `buildRenderScene` — the order, the exclusions, the layer
 * stacks, the light, what casts a shadow. What is left here is paint, which is the whole point of
 * the split: a backend that decides something is a backend that can disagree with the other one.
 *
 * `site` is still taken alongside the scene because the fence, the gates and the kerb are drawn
 * from resolvers that read it directly. They move onto the scene when the Pixi backend needs
 * them too; until then, duplicating the resolver call would be the drift this seam exists to stop.
 */
export function drawScene(
  context: PlanContext,
  rendered: RenderScene,
  site: SiteSection,
  pass: PlanPass,
  rasterOrigin: Point,
): void {
  const { boundary } = rendered;
  if (boundary.length < 3) return;

  const { pxPerMetre } = pass;
  const { light } = rendered;
  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  if (rendered.view === 'visualise' && rendered.rendererVersion === 'v2') {
    for (const name of RENDER_PASSES) drawPrimitivePass(context, rendered, name, pass, rasterOrigin);
    if (pass.grade !== false) gradeScene(context, rendered, pass, rasterOrigin);
    return;
  }

  context.save();

  /* The ground, clipped to the plot; everything else is drawn inside this clip. */
  tracePath(context, boundary, toPx);
  context.clip();
  context.fillStyle = PLOT_GROUND;
  context.fill();

  for (const item of rendered.ground) {
    drawItem(context, item, pass, light, toPx, rasterOrigin);
  }

  /*
   * The edging courses, between the ground and everything that stands on it.
   *
   * Above the surfaces because a course is laid *on* the ground it edges, and below the shadows
   * and the objects because it is still ground: a tree's shadow falls across a brick course, and
   * the shed stands on top of one. Nothing here is an element — see `RenderScene.edging`.
   */
  for (const surface of rendered.edging) {
    drawSurface(context, surface, pass, light, toPx, rasterOrigin);
  }

  /*
   * The shade where the ground's own pieces meet, above the courses and below the shadows. Same
   * place the v2 pass order puts it, or the 2D Plan on screen and the exported PNG would disagree
   * about whether a bed sits in the lawn or on it.
   */
  drawSeams(context, rendered, pass, toPx);

  /*
   * The retaining faces, above the edging and still below everything that stands up.
   *
   * A flat fill rather than a pattern, deliberately: at 450 mm a wall top is a couple of pixels
   * across at plan zoom, and asking the module painter for a course of blockwork inside it would
   * spend a raster on something that lands as one tone anyway. The tone is the host's own paving
   * darkened, so a level change reads as the same material stepping down rather than as a foreign
   * object laid round it.
   *
   * In Visualise a retaining wall has a face you can see, so it sorts into the stack with
   * everything else that stands up and is drawn there instead — a plant in front of a terrace has
   * to be able to cover the wall holding it up.
   */
  if (rendered.view !== 'visualise') {
    for (const level of rendered.levels) {
      if (level.surface) {
        drawSurface(context, level.surface, pass, light, toPx, rasterOrigin);
        continue;
      }
      context.fillStyle = level.colour;
      tracePath(context, level.outline, toPx);
      context.fill();
    }
  }

  drawShadows(context, rendered, pass, toPx);

  /*
   * Planting is part of the depth-sorted stack in Visualise, so drawing it here as well would draw
   * every plant twice — once under the fence and once over it. In the plan view the stack is empty
   * and this is the only place plants are drawn, exactly as before.
   */
  if (rendered.view !== 'visualise') drawPlants(context, rendered, pass, light, toPx);

  context.restore();

  drawOverlay(context, rendered, site, pass, rasterOrigin);

  /*
   * The scene grade, last, and in **both** views — _this reverses_ "only in Visualise".
   *
   * The old split was never a claim that the plan wanted a different picture; it was that the plan
   * already had a finishing pass of its own, `export-plan.ts`'s `finish()`, which lifted contrast
   * and saturation. That pass predates the measurement: it was a look somebody chose, and it pulls
   * two of this grade's terms in the opposite direction. One measured grade over every drawing is
   * what the sheets, the thumbnails and the download can actually be compared by, and `finish()`
   * is gone.
   *
   * Over the plot's own box rather than the whole canvas: a sheet is drawn with a paper margin and a
   * thumbnail is not, so grading everything would darken the paper on one and nothing on the other,
   * and the two would stop being the same picture at different sizes.
   *
   * On screen this same grade arrives as a CSS `filter` on the wrapper instead — Visualise's, and
   * now the editor's `EditorScene` too — because in both the WebGL ground and this 2D overlay are
   * separate DOM canvases and no single context holds both. `grade.ts` carries the one set of
   * constants and `grade.test.ts` pins the two applications to each other.
   */
  if (pass.grade !== false) {
    const box = boundingBox(boundary);
    const topLeft = toPx({ x: box.minX, y: box.minY });
    const bottomRight = toPx({ x: box.minX + box.width, y: box.minY + box.length });
    const x = Math.max(0, Math.floor(topLeft.x));
    const y = Math.max(0, Math.floor(topLeft.y));

    applyGrade(
      context as unknown as GradeTarget,
      x,
      y,
      Math.ceil(bottomRight.x) - x,
      Math.ceil(bottomRight.y) - y,
    );
  }
}

function gradeScene(context: PlanContext, scene: RenderScene, pass: PlanPass, origin: Point): void {
  const { bounds } = scene;
  const x = Math.max(0, Math.floor((bounds.minX - origin.x) * pass.pxPerMetre));
  const y = Math.max(0, Math.floor((bounds.minY - origin.y) * pass.pxPerMetre));
  const right = Math.ceil((bounds.minX + bounds.width - origin.x) * pass.pxPerMetre);
  const bottom = Math.ceil((bounds.minY + bounds.length - origin.y) * pass.pxPerMetre);
  if (right > x && bottom > y) applyGrade(context as unknown as GradeTarget, x, y, right - x, bottom - y);
}

/** The pass order and inputs are shared with Pixi; this function only puts down pixels. */
export function drawPrimitivePass(context: PlanContext, scene: RenderScene, name: RenderPassName,
  pass: PlanPass, origin: Point): void {
  const toPx = (point: Point): Point => ({ x: (point.x - origin.x) * pass.pxPerMetre, y: (point.y - origin.y) * pass.pxPerMetre });
  context.save();
  if (name !== 'access') { tracePath(context, scene.boundary, toPx); context.clip(); }
  if (name === 'seams') {
    drawSeams(context, scene, pass, toPx);
  } else if (name === 'cast-shadows') {
    drawShadows(context, scene, pass, toPx);
  } else if (name === 'contacts') {
    drawContactPass(context, scene, pass, toPx);
    for (const primitive of scene.passes.contacts) if (primitive.kind === 'plant-mass') {
      drawPrimitive(context, primitive, scene, pass, origin);
    }
  } else {
    for (const primitive of scene.passes[name]) drawPrimitive(context, primitive, scene, pass, origin);
  }
  context.restore();
}

export function drawContactPass(context: PlanContext, scene: RenderScene, pass: PlanPass, toPx: (point: Point) => Point): void {
  context.globalAlpha = FENCE_SHADE_OPACITY;
  context.fillStyle = COLOUR.fenceShade;
  for (const band of fenceShadeBands(scene.boundary, scene.light)) { tracePath(context, band, toPx); context.fill(); }
  context.globalAlpha = 1;
  const shadow = pass.assets?.(CONTACT_SHADOW_SPRITE)[0];
  const { bounds } = scene;
  const scale = Math.min(pass.pxPerMetre, 4096 / Math.max(bounds.width, bounds.length));
  const canvas = pass.makeCanvas(Math.max(1, Math.ceil(bounds.width * scale)), Math.max(1, Math.ceil(bounds.length * scale)));
  const scratch = canvas.getContext('2d');
  if (!scratch) return;
  const localPx = (point: Point) => ({ x: (point.x - bounds.minX) * scale, y: (point.y - bounds.minY) * scale });
  scratch.fillStyle = SHADOW_TONE;
  for (const primitive of scene.passes.contacts) {
    if (primitive.kind !== 'contact-shadow' || !primitive.outline) continue;
    tracePath(scratch, primitive.outline, localPx); scratch.fill();
  }
  for (const primitive of scene.passes.contacts) {
    if (primitive.kind !== 'contact-shadow' || primitive.outline || !shadow) continue;
    const reach = primitive.radius * CONTACT_SHADOW_SCALE;
    const offset = primitive.radius * CONTACT_SHADOW_OFFSET_RATIO;
    scratch.drawImage(shadow.image, (primitive.at.x - scene.light.x * offset - reach - bounds.minX) * scale,
      (primitive.at.y - scene.light.y * offset - reach - bounds.minY) * scale, reach * 2 * scale, reach * 2 * scale);
  }
  const at = toPx({ x: bounds.minX, y: bounds.minY });
  context.globalAlpha = CONTACT_SHADOW_ALPHA;
  context.drawImage(canvas, at.x, at.y, canvas.width / scale * pass.pxPerMetre, canvas.height / scale * pass.pxPerMetre);
  context.globalAlpha = 1;
}

export function drawPrimitive(context: PlanContext, primitive: RenderPrimitive, scene: RenderScene,
  pass: PlanPass, origin: Point): void {
  const toPx = (point: Point): Point => ({ x: (point.x - origin.x) * pass.pxPerMetre, y: (point.y - origin.y) * pass.pxPerMetre });
  switch (primitive.kind) {
    case 'terrain':
      context.fillStyle = PLOT_GROUND; tracePath(context, primitive.outline, toPx); context.fill(); return;
    case 'surface': {
      const surface = primitive.item.surface;
      // Match the browser's local raster origin and sampling. Painting a large texture
      // directly into the export viewport changes minification and subpixel filtering.
      const raster = surface?.material ? renderSurfacePattern(surface.outline, surface.material,
        surface.anchor, surface.seed, { ...pass, light: scene.light, layers: surface.layers,
          exclusions: surface.exclusions ?? undefined, cutEdge: surface.cutEdge ?? undefined,
          centreline: surface.centreline ?? undefined, element: surface.element }) : null;
      if (raster) {
        const at = toPx(raster.originMetres);
        context.drawImage(raster.canvas, at.x, at.y,
          raster.widthPx / raster.pxPerMetre * pass.pxPerMetre,
          raster.heightPx / raster.pxPerMetre * pass.pxPerMetre);
      } else drawItem(context, primitive.item, pass, scene.light, toPx, origin);
      return;
    }
    case 'linear-course': {
      if (primitive.height > 0) {
        const source: ExtrusionSource = { of: 'edging', surface: primitive.surface, height: primitive.height };
        paintFaces(context, extrude(primitive.surface.outline, primitive.height, scene.light),
          materialFill(primitive.surface.element), skinFor(source, pass), pass.pxPerMetre, toPx, false);
      }
      context.save(); context.translate(0, -liftPx(primitive.height, pass.pxPerMetre));
      drawLinearCourse(context, primitive, pass, origin); context.restore(); return;
    }
    case 'sprite':
    case 'extrusion': {
      const lookup = pass.assets;
      const standingPass: PlanPass = { ...pass, contactShadows: false,
        assets: lookup ? (id) => id === CONTACT_SHADOW_SPRITE ? [] : lookup(id) : undefined };
      let opacity = 1;
      if (primitive.node.kind === 'plant') {
        opacity = pass.plantOpacity ?? 1 - plantMassOpacity(scene.clusters, primitive.node.id, pass.lodPxPerMetre ?? pass.pxPerMetre);
      }
      if (opacity <= 0) return;
      context.save();
      // Darken the opaque object itself, never add a rectangular wash around its raster.
      const oldFilter = context.filter ?? 'none';
      if (scene.night && context.filter !== undefined) context.filter = `brightness(${1 - scene.night * NIGHT_MAX_ALPHA * 0.8})`;
      context.globalAlpha = opacity;
      drawStackNode(context, primitive.node, scene, standingPass, scene.light, toPx, origin, null);
      context.filter = oldFilter;
      context.restore();
      return;
    }
    /*
     * One drift, not a heap of blobs.
     *
     * Every plant in the cluster used to be drawn straight onto the scene at the mass opacity, so
     * wherever two of them overlapped — which, in a drift, is everywhere — the tone was laid down
     * twice and came out darker. The cluster read as a lumpy pile rather than as one body of
     * planting, which is the whole reason for massing it in the first place.
     *
     * Same trick the shadow layer uses, and for the same reason: fill the pieces **opaque** into a
     * scratch canvas, then composite that once. Overlap merges for free, with no polygon union.
     */
    case 'plant-mass': {
      const opacity = pass.massOpacity ?? clusterMassOpacity(primitive.cluster, pass.lodPxPerMetre ?? pass.pxPerMetre);
      if (opacity <= 0) return;
      const { bounds } = primitive.cluster;
      const margin = 1;
      const width = Math.max(1, Math.ceil((bounds.width + margin * 2) * pass.pxPerMetre));
      const height = Math.max(1, Math.ceil((bounds.length + margin * 2) * pass.pxPerMetre));
      if (width > MAX_MASS_RASTER_PX || height > MAX_MASS_RASTER_PX) return;

      const scratch = pass.makeCanvas(width, height);
      const drift = scratch.getContext('2d');
      if (!drift) return;
      const local = (point: Point) => ({
        x: (point.x - bounds.minX + margin) * pass.pxPerMetre,
        y: (point.y - bounds.minY + margin) * pass.pxPerMetre,
      });

      for (const plant of primitive.cluster.plants) {
        const at = local(plant.at);
        drawBlob(drift, { light: scene.light, form: 'clipped-mass', x: at.x, y: at.y,
          radius: plant.spread * 0.52 * pass.pxPerMetre, lobes: 7,
          tone: cssToRgb(pick(plant.blob.palette, plant.tone)),
          random: moduleRandom(`${primitive.id}:mass`, Math.round(plant.at.x * 100), Math.round(plant.at.y * 100)) });
      }

      const at = toPx({ x: bounds.minX - margin, y: bounds.minY - margin });
      context.save();
      context.globalAlpha = opacity;
      context.drawImage(scratch, at.x, at.y, width, height);
      context.restore();
      return;
    }
    case 'ambient':
      context.save(); context.globalAlpha = primitive.night * NIGHT_MAX_ALPHA;
      context.fillStyle = NIGHT_TONE; tracePath(context, scene.boundary, toPx); context.fill(); context.restore(); return;
    case 'ground-light':
    case 'emissive': {
      const pool = pass.assets?.(LIGHT_POOL_SPRITE)[0];
      if (!pool) return;
      const at = toPx(primitive.light.at);
      const glow = primitive.kind === 'emissive';
      const radius = (glow ? Math.min(0.18, primitive.light.radius / 5) : primitive.light.radius) * pass.pxPerMetre;
      context.save(); context.globalCompositeOperation = 'lighter';
      context.globalAlpha = primitive.light.intensity * (glow ? 0.9 : LIGHT_POOL_ALPHA);
      context.drawImage(pool.image as PatternCanvas, at.x - radius, at.y - radius, radius * 2, radius * 2);
      context.restore(); return;
    }
    case 'access': drawAccess(context, primitive.site, pass.pxPerMetre, toPx); return;
    case 'shadow-caster':
    case 'contact-shadow': return; // These are unioned once by their pass compositor.
  }
}

/**
 * Everything that stands above the planting: the symbols, the house and the boundary.
 *
 * Split out so the WebGL backend can share it rather than reimplement it. Pixi is worth having
 * for the ground and for the thousands of plant sprites, which is a batching problem; it is not
 * worth having for the twenty-odd pergolas, sheds, trees and benches on a plan, and a second
 * implementation of those in WebGL would be a second set of drawing rules to drift from the
 * first — exactly what `buildRenderScene` exists to prevent. So Visualise composites this pass
 * onto a 2D canvas over the WebGL one, from the same scene and the same transform.
 */
export function drawOverlay(
  context: PlanContext,
  rendered: RenderScene,
  site: SiteSection,
  pass: PlanPass,
  rasterOrigin: Point,
): void {
  const { boundary } = rendered;
  if (boundary.length < 3) return;

  const { pxPerMetre } = pass;
  const { light } = rendered;
  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  /*
   * Two orders, and which one applies is the whole difference between the views.
   *
   * **Plan** keeps the order it has always had: every object, then the house, then the boundary,
   * each pass complete before the next begins. It is a diagram, and in a diagram the building is
   * always legible and the fence is always the edge of the drawing. Nothing about it has changed.
   *
   * **Visualise** draws one depth-sorted list instead. That is what lets a canopy fall across a
   * roof and a border disappear behind the fence standing in front of it — neither of which the
   * pass order above can express at all, because it draws every fence after every plant whatever
   * the two are doing.
   */
  if (rendered.view === 'visualise') {
    context.save();
    tracePath(context, boundary, toPx);
    context.clip();

    /*
     * The shade the boundary throws onto the ground inside it, under everything that stands there.
     *
     * It matters more here than in the flat view, not less. A wall running up and down the screen
     * is seen exactly edge-on and shows no face at all — the price of lifting straight up — so on
     * two sides of every rectangular plot this band and the cast shadow are the only things saying
     * the boundary has any height. Drawn first so a border planted against the fence sits on it.
     */
    context.globalAlpha = FENCE_SHADE_OPACITY;
    context.fillStyle = COLOUR.fenceShade;
    for (const band of fenceShadeBands(boundary, light)) {
      tracePath(context, band, toPx);
      context.fill();
    }
    context.globalAlpha = 1;

    drawStack(context, rendered, pass, light, toPx, rasterOrigin);
    context.restore();
  } else {
    context.save();
    tracePath(context, boundary, toPx);
    context.clip();

    for (const item of rendered.objects) {
      drawItem(context, item, pass, light, toPx, rasterOrigin);
    }

    context.restore();

    /* The house sits above the planting so a bed can run right up to the wall. */
    if (rendered.house) drawHouse(context, rendered.house, pass, pxPerMetre, toPx, false);

    drawFence(context, boundary, rendered.boundaryRuns, pxPerMetre, light, toPx);
  }

  drawAccess(context, site, pxPerMetre, toPx);

  drawLighting(context, rendered, pass, toPx);
}

/* ---------------------------------------------------------------- the elevated stack */

/**
 * Everything that stands up, drawn back to front.
 *
 * One loop over `RenderScene.stack`, which `buildStack` has already sorted; this function makes no
 * ordering decisions of its own and must not start making any. That separation is what lets the
 * order be asserted in Node — Pixi cannot be pixel-tested, so the only way the two backends can be
 * known to agree about depth is for neither of them to decide it.
 */
function drawStack(
  context: PlanContext,
  rendered: RenderScene,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const shadow = pass.assets?.(CONTACT_SHADOW_SPRITE)[0] ?? null;

  for (const node of rendered.stack) {
    drawStackNode(context, node, rendered, pass, light, toPx, rasterOrigin, shadow);
  }
}

/**
 * One standing thing.
 *
 * Exported because Pixi draws the same node into a raster of its own: the plants there are batched
 * WebGL sprites, and everything else — a house, a shed, four fence runs, a couple of retaining
 * walls — is a handful of objects a frame, which is far too few to be worth a second painter. So
 * Pixi calls this, and there is exactly one implementation of what a shed looks like.
 */
export function drawStackNode(
  context: PlanContext,
  node: RenderNode,
  rendered: RenderScene,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
  shadow: LoadedAsset | null,
): void {
  switch (node.kind) {
    case 'plant':
      drawPlantNode(context, node, pass, light, toPx, shadow);
      return;
    case 'object':
      drawObjectNode(context, node, pass, light, toPx, rasterOrigin);
      return;
    case 'extrusion':
      drawExtrusionNode(context, node, pass, light, toPx, rasterOrigin);
      return;
    case 'house':
      drawHouseNode(context, node, pass, toPx);
      return;
  }
}

/**
 * The visible faces of anything raised, and the strip of ground at its foot.
 *
 * The foot band is not decoration. A wall running up and down the screen is seen exactly edge-on
 * and has no face at all — the honest consequence of lifting straight up the screen — so without a
 * mark where it meets the ground it would appear to hover. The band is the same class of drawing
 * convention as the contact shadow under a sprite: it says "this meets the ground here", and says
 * nothing about the sun.
 */
function paintFaces(
  context: PlanContext,
  extrusion: Extrusion,
  tone: string,
  skin: FaceSkin | null,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
  contact = true,
): void {
  if (extrusion.height <= 0) return;

  const depth = footBandDepth(extrusion.height);

  context.globalAlpha = 0.14;
  context.fillStyle = SHADOW_TONE;
  for (const face of contact ? extrusion.faces : []) {
    tracePath(context, footBand(face.base[0], face.base[1], depth), toPx);
    context.fill();
  }
  context.globalAlpha = 1;

  /* Far to near, as `extrude` sorted them: on a concave outline that is what stops a near limb's
   * face showing through a far one's. */
  for (const face of extrusion.faces) {
    if (skin && paintSkinnedFace(context, face, extrusion.height, tone, skin, pxPerMetre, toPx)) {
      continue;
    }
    context.fillStyle = faceFill(tone, face.lit);
    tracePath(context, face.quad, toPx);
    context.fill();
  }
}

/** A material photographed flat, and the real size one tile of it covers. */
interface FaceSkin {
  image: AssetImage;
  metres: { w: number; h: number };
}

/**
 * One face, with its material tiled along it at the material's real size.
 *
 * ## The frame, which is the whole of this function
 *
 * A face is a **parallelogram**: its base runs along the wall at whatever angle the wall is, and
 * its height runs straight up the screen regardless. Those two axes are not perpendicular, so no
 * amount of translate-and-rotate reaches them — which is why `PatternContext` grew a `transform`.
 *
 * Given the matrix, everything else is easy and, more to the point, *correct*: inside it one unit
 * is one metre along the wall and one metre up it, so a tile is drawn at its manifest size and a
 * 120 mm board is 120 mm on every wall of every building at every rotation. Tiling in screen space
 * instead would have run the boards across the drawing rather than along the wall.
 *
 * Returns false when the tile would be too small to read, which is the same judgement `lod.ts`
 * makes everywhere else: below a couple of pixels a board is noise, and the flat fill is the
 * better drawing.
 */
function paintSkinnedFace(
  context: PlanContext,
  face: Extrusion['faces'][number],
  height: number,
  tone: string,
  skin: FaceSkin,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): boolean {
  const { metres } = skin;
  if (metres.w <= 0 || metres.h <= 0) return false;
  // How tall the face is on screen, in pixels — the axis the lift squashes.
  if (height * RISE * pxPerMetre < MIN_SKINNED_FACE_PX) return false;

  const [start, end] = face.base;
  const from = toPx(start);
  const to = toPx(end);
  const along = { x: (to.x - from.x) / face.length, y: (to.y - from.y) / face.length };
  const top = toPx(lift(start, height));

  context.save();
  tracePath(context, face.quad, toPx);
  context.clip();
  /* u runs along the wall, v runs down it from the eaves. One unit is one metre in both. */
  context.transform(along.x, along.y, 0, RISE * pxPerMetre, top.x, top.y);

  const phase = (face.skinOffset ?? 0) % metres.w;
  const columns = Math.ceil((face.length + phase) / metres.w);
  const rows = Math.ceil(height / metres.h);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      // The cast is the type being narrower than the runtime, as everywhere else in this file.
      context.drawImage(
        skin.image as PatternCanvas,
        column * metres.w - phase,
        row * metres.h,
        metres.w,
        metres.h,
      );
    }
  }

  /* The light, and the material's own tone: the skin is photographed flat because only the
   * renderer knows which way this face points. */
  context.globalAlpha = FACE_SKIN_TINT;
  context.fillStyle = faceFill(tone, face.lit);
  context.fillRect(0, 0, face.length, height);
  context.globalAlpha = 1;

  context.restore();
  return true;
}

/** Below this a face is too shallow on screen to show a material, and a flat tone reads better. */
const MIN_SKINNED_FACE_PX = 3;

/**
 * What a thing's vertical faces are made of.
 *
 * Each answer comes from what the renderer already knows about the object rather than from a new
 * table: a boundary has a `BoundaryKind`, a retaining wall and a building have a **material the
 * user chose**, and only the house — which has no material, because it is not an element — needs a
 * named default.
 *
 * That ordering matters. A shed the user made of painted timber shows painted boards, because
 * `MATERIAL_ASSETS` already holds the photograph of that product; it is not overridden by a generic
 * fence skin just because both are timber. `null` is the ordinary answer and means a flat tone,
 * which is what everything drew before any of this existed.
 */
function skinFor(source: ExtrusionSource, pass: PlanPass): FaceSkin | null {
  const id =
    source.of === 'boundary'
      ? BOUNDARY_SKINS[source.run.kind]
      : source.of === 'level'
        ? faceAssetFor(source.level.surface?.element.material)
        : source.of === 'edging'
          ? faceAssetFor(source.surface.element.material)
          : faceAssetFor(source.element.material);

  return loadSkin(id, pass);
}

/** A material's own face photograph, or the tile it is drawn with when it has no modular face. */
function faceAssetFor(material: string | undefined): AssetId | undefined {
  const assets = materialAssets(material);
  return assets?.face ?? assets?.texture;
}

function loadSkin(id: AssetId | undefined, pass: PlanPass): FaceSkin | null {
  if (!id) return null;
  const loaded = pass.assets?.(id)[0];
  if (!loaded) return null;
  return { image: loaded.image, metres: ASSET_FAMILIES[id].metres };
}

/**
 * A built thing: its walls, and then the plan's own drawing of it sitting on top of them.
 *
 * The second half is the part worth understanding. Because the lift is a rigid translation, the top
 * of an extruded prism is its own footprint moved up the screen — so **the plan picture is the top
 * of the elevated picture**, and every symbol the flat view already knows how to draw (a shed's two
 * roof slopes, a gazebo's four hips, a pergola's beams, a retaining wall's top course) is drawn by
 * the code that already draws it, into a translated context. No symbol needed a second version.
 */
function drawExtrusionNode(
  context: PlanContext,
  node: RenderExtrusionNode,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { extrusion, source } = node;
  if ((node.contribution === 'post' || node.contribution === 'beam') && source.of === 'element') {
    const tone = materialFill(source.element);
    paintFaces(context, extrusion, tone, skinFor(source, pass), pass.pxPerMetre, toPx, false);
    context.fillStyle = rgbToCss(shiftBrightness(cssToRgb(tone), node.contribution === 'beam' ? 0.07 : -0.12));
    tracePath(context, extrusion.top, toPx); context.fill();
    return;
  }

  /*
   * A flight of steps is the one thing here that is not a prism: it descends. Handled before the
   * faces are painted, because a single block the height of the top step is not a smaller version
   * of a flight, it is a different object.
   */
  if (source.of === 'element' && resolveSymbol(source.element) === 'steps') {
    drawFlight(context, source.element, source.surface, pass, light, toPx, rasterOrigin);
    return;
  }

  const tone =
    source.of === 'element'
      ? materialFill(source.element)
      : source.of === 'boundary'
        ? BOUNDARY_PALETTE[source.run.kind].body
        : source.of === 'edging'
          ? materialFill(source.surface.element)
          : source.level.colour;

  paintFaces(context, extrusion, tone, skinFor(source, pass), pass.pxPerMetre, toPx, pass.contactShadows !== false);

  context.save();
  context.translate(0, -liftPx(extrusion.height, pass.pxPerMetre));

  if (source.of === 'edging') {
    drawSurface(context, source.surface, pass, light, toPx, rasterOrigin);
  } else if (source.of === 'element') {
    const roofed = drawRoofedStructure(
      context,
      source.element,
      source.surface,
      pass,
      light,
      toPx,
      rasterOrigin,
    );
    if (!roofed) {
      drawItem(
        context,
        { element: source.element, part: 'all', surface: source.surface, visualLayer: 'structure' },
        pass,
        light,
        toPx,
        rasterOrigin,
      );
    }
  } else if (source.of === 'boundary') {
    drawBoundaryTop(context, source.run, source.inward, extrusion, pass.pxPerMetre, toPx, node.parentRun);
  } else if (source.level.surface) {
    if (pass.contactShadows === false) drawLinearCourse(context,
      { surface: source.level.surface, course: compileLinearCourse(source.level.surface) }, pass, rasterOrigin);
    else drawSurface(context, source.level.surface, pass, light, toPx, rasterOrigin);
  } else {
    context.fillStyle = source.level.colour;
    tracePath(context, source.level.outline, toPx);
    context.fill();
  }

  context.restore();
}

/**
 * A flight of steps, descending.
 *
 * ## Why this is not an extrusion
 *
 * Everything else that stands up is a prism: one footprint, one height, faces round the sides. A
 * flight is not. Raised as a prism it comes out a solid block the height of its top step, which
 * hides the fact that it is a flight at all — and the whole reason a flight exists in the plan is
 * to *resolve* a level change, so drawing it as a block is drawing the problem instead of the
 * answer.
 *
 * ## How the treads are worked out
 *
 * Every number comes from `stepFlight(element.elevation)`, which is the same function the level
 * change itself is derived from, so the drawing and the rise cannot disagree. The flight is divided
 * into `risers` bands along its depth, and band `i` counted from the terrace sits at
 * `elevation × (risers − i) / risers` — so the first band is flush with the terrace it comes off and
 * the step down from the last band to the ground is the final riser. `risers` bands, `risers`
 * risers.
 *
 * **The terrace end is the `-depth/2` end**, which is a convention `stepsFromTerrace` sets when it
 * places the flight just beyond the terrace's far edge with the frame's own bearing, and which
 * `stepNosings` already relies on when it counts its nosings from that edge.
 *
 * Each band is drawn far-to-near so a painter with no depth test gets the right picture, and each
 * one's tread is the flight's own surface raster clipped to the band and lifted — so the paving runs
 * continuously up the steps rather than restarting on every one.
 */
function drawFlight(
  context: PlanContext,
  element: DesignElement,
  surface: RenderSurface | null,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { shape } = element;
  const flight = stepFlight(element.elevation ?? 0);

  if (shape.kind !== 'rect' || !flight || flight.risers < 1) {
    drawSurface(context, surface, pass, light, toPx, rasterOrigin);
    return;
  }

  const { risers } = flight;
  const bandDepth = shape.depth / risers;
  const tone = materialFill(element);

  const bands = Array.from({ length: risers }, (_, i) => {
    const band: PlanGeometry = {
      kind: 'rect',
      centre: rectToPolygonCentre(shape, -shape.depth / 2 + bandDepth * (i + 0.5)),
      width: shape.width,
      depth: bandDepth,
      rotation: shape.rotation,
    };
    const outline = geometryOutline(band);
    return {
      outline,
      height: (element.elevation ?? 0) * ((risers - i) / risers),
      depth: depthOf(outline),
    };
  });

  // Far to near, so the riser of a nearer tread covers the one behind it.
  bands.sort((a, b) => a.depth - b.depth);

  for (const band of bands) {
    paintFaces(context, extrude(band.outline, band.height, light), tone, null, pass.pxPerMetre, toPx, pass.contactShadows !== false);

    context.save();
    tracePath(context, band.outline, toPx);
    context.clip();
    context.translate(0, -liftPx(band.height, pass.pxPerMetre));
    if (surface) {
      drawSurface(context, surface, pass, light, toPx, rasterOrigin);
    } else {
      context.fillStyle = tone;
      tracePath(context, band.outline, toPx);
      context.fill();
    }
    context.restore();
  }
}

/**
 * The centre of a band `offset` metres along the flight's own depth axis, in world metres.
 *
 * The rect's local +y is its depth, so a band's centre is the flight's centre moved along that axis
 * by the rect's own rotation — which is what keeps a flight off a rotated house running the right
 * way.
 */
function rectToPolygonCentre(
  shape: { centre: Point; rotation: number },
  offset: number,
): Point {
  const angle = (shape.rotation * Math.PI) / 180;
  return {
    x: shape.centre.x - Math.sin(angle) * offset,
    y: shape.centre.y + Math.cos(angle) * offset,
  };
}

/**
 * A garden building: its floor at true size, then its roof oversailing it.
 *
 * ## Why this is not just `drawItem`
 *
 * A roof is bigger than the walls it sits on, and that one fact is most of what makes a shed read
 * as a building rather than as an extruded block with a line across it. But only the *roof* may
 * grow: the deck beneath it is the footprint the validator checked and the area the schedule
 * counts, and it has to stay exactly the size the document says.
 *
 * So the rectangle is grown **here, once, for the symbol only**, and every roof painter —
 * `drawShed`, `drawGazebo`, `drawGardenRoom`, `drawGreenhouse` — draws from its element's own rect
 * exactly as it always has, knowing nothing about any of this. Threading an overhang through
 * `drawSymbol` and into five painters would have been the same picture and five more places to get
 * it wrong.
 *
 * Returns false for anything that is not a roofed building, so the caller falls back to the
 * ordinary path: a pergola is an open frame and an oversailing eaves line round thin air would be
 * a claim about a roof it does not have.
 */
function drawRoofedStructure(
  context: PlanContext,
  element: DesignElement,
  surface: RenderSurface | null,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): boolean {
  const symbol = resolveSymbol(element);
  const { shape } = element;
  if (!symbol || !ROOFED_SYMBOLS.has(symbol) || shape.kind !== 'rect') return false;

  const grown: DesignElement = {
    ...element,
    shape: {
      ...shape,
      width: shape.width + STRUCTURE_OVERHANG * 2,
      depth: shape.depth + STRUCTURE_OVERHANG * 2,
    },
  };

  /*
   * **The boarding is drawn to the roof's extent, not to the footprint's**, and this is the whole
   * subtlety of giving a garden building an overhang.
   *
   * `drawShed` washes its two pitches over the boards at `ROOF_ALPHA` rather than replacing them,
   * deliberately, so a shed still reads as timber. That works perfectly while the roof and the
   * boards are the same rectangle. Grow the roof and the oversailing rim has nothing beneath it, so
   * the wash composites over whatever the building is standing on — and a shed comes out with a
   * translucent grey frame round it instead of eaves.
   *
   * Drawing the boards to the roof line fixes it and is the truthful drawing: what you are looking
   * at from above *is* the roof's own boarding. The anchor and seed are the element's own, so the
   * grain stays continuous and deterministic; the footprint the validator checks and the area the
   * schedule counts are untouched, because neither of them reads this.
   */
  drawSurface(
    context,
    surface ? { ...surface, element: grown, outline: elementOutline(grown) } : null,
    pass,
    light,
    toPx,
    rasterOrigin,
  );

  drawSymbol(context, grown, pass.pxPerMetre, light, pass.assets, toPx);
  paintEavesShade(context, elementOutline(grown), toPx);
  return true;
}

/**
 * The strip of shade an oversailing roof throws on the wall under it.
 *
 * Drawn **after** the roof and only on the edges the camera can see the outside of, which is the
 * second attempt and the reason the first was wrong. That one filled the whole roof outline,
 * offset down the screen, *before* the roof and relied on the roof covering it. That works for the
 * house, whose roof is opaque, and fails completely for a shed, whose roof is drawn at
 * `ROOF_ALPHA` **over** its boards on purpose — so the shadow showed straight through it and laid a
 * grey sheet across the whole building.
 *
 * Drawing the sliver explicitly depends on nothing being opaque, which is the only version that can
 * be right for both.
 */
function paintEavesShade(
  context: PlanContext,
  eaves: Point[],
  toPx: (point: Point) => Point,
): void {
  context.globalAlpha = EAVES_SHADOW_ALPHA;
  context.fillStyle = SHADOW_TONE;
  for (const edge of visibleEdges(eaves)) {
    tracePath(context, footBand(edge.start, edge.end, EAVES_SHADOW_DEPTH), toPx);
    context.fill();
  }
  context.globalAlpha = 1;
}

/**
 * The top of a boundary run: the band you look down on, and its posts.
 *
 * A per-run twin of the loop in `drawFence`, rather than a call into it, because the runs are no
 * longer drawn together — each one now sorts into the stack at its own depth, so the near fence can
 * be in front of the garden and the far one behind it. The gate gaps are still painted out
 * afterwards by `drawAccess`, which runs over the whole drawing at the end.
 */
function drawBoundaryTop(
  context: PlanContext,
  run: BoundaryRun,
  inward: Point,
  extrusion: Extrusion,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
  parentRun?: BoundaryRun,
): void {
  const palette = BOUNDARY_PALETTE[run.kind];
  const bandPx = run.thickness * pxPerMetre;

  if (palette.dashed || bandPx < MIN_BAND_PX) {
    const start = toPx(run.start);
    const end = toPx(run.end);
    context.strokeStyle = palette.body;
    context.lineWidth = palette.dashed ? 1.5 : 2.5;
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    return;
  }

  /* The extrusion's own footprint — `boundaryBand`, already resolved — so the top of the wall and
   * the faces below it cannot land in different places. */
  context.fillStyle = palette.body;
  tracePath(context, extrusion.footprint, toPx);
  context.fill();
  if (parentRun) {
    context.strokeStyle = palette.body; context.lineWidth = 0.75; context.stroke();
  }

  // A wall's coping: the light line along the top that says masonry rather than timber.
  if (palette.cap) {
    const inner = (point: Point) => ({
      x: point.x + inward.x * run.thickness,
      y: point.y + inward.y * run.thickness,
    });
    const from = toPx(inner(run.start));
    const to = toPx(inner(run.end));
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = Math.max(1, bandPx * 0.3);
    context.strokeStyle = palette.cap;
    context.stroke();
  }

  if (!palette.detail) return;

  const postRadius = Math.max(1.2, Math.min(3.2, pxPerMetre * 0.05));
  const posts = runPosts(
    parentRun ?? run,
    pxPerMetre,
    { x: (inward.x * run.thickness) / 2, y: (inward.y * run.thickness) / 2 },
    crownInset(run),
  );

  context.fillStyle = palette.detail;

  for (const post of posts) {
    if (parentRun) {
      const dx = run.end.x - run.start.x, dy = run.end.y - run.start.y;
      const t = ((post.x - run.start.x) * dx + (post.y - run.start.y) * dy) / (dx * dx + dy * dy);
      if (t < -1e-5 || t >= 1 - 1e-5) continue;
    }
    const at = toPx(post);

    if (run.kind === 'hedge') {
      // A hedge's "posts" are its crowns: round, overlapping, and read as one mass.
      const radius = Math.max(postRadius, bandPx / 2);
      context.save();
      context.globalAlpha = 0.75;
      context.beginPath();
      context.arc(at.x, at.y, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
      continue;
    }

    context.fillRect(at.x - postRadius, at.y - postRadius, postRadius * 2, postRadius * 2);
  }
}

/**
 * The house: its ground shadow, its walls, and the plan's own house drawing on top of them.
 *
 * `drawHouse` is reused whole, into a context translated up by the eaves height, so the roof
 * planes, their shading and their slate courses are the same picture the flat view draws — which
 * is the point of deriving the roof rather than storing one. The openings are not drawn over a
 * roof, and that rule is already inside `drawHouse`: from directly above you cannot see the doors
 * beneath one.
 */
function drawHouseNode(
  context: PlanContext,
  node: RenderHouseNode,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  paintFaces(context, node.walls, HOUSE_WALL_TONE, loadSkin(HOUSE_WALL_SKIN, pass), pass.pxPerMetre, toPx, pass.contactShadows !== false);
  drawWallOpenings(context, node, toPx);

  context.save();
  context.translate(0, -liftPx(node.walls.height, pass.pxPerMetre));

  drawHouse(context, node.house, pass, pass.pxPerMetre, toPx, true);

  /*
   * The shade the eaves throw on the wall beneath them: the second half of what makes a roof read
   * as a roof, where the oversail is the first. A drawing convention in the `houseGroundShadow`
   * class, not a solar claim, and unconditional for the same reason — a building casts this
   * whatever the plan knows about where it is.
   */
  if (node.house.roof) paintEavesShade(context, node.house.roof.eaves, toPx);

  context.restore();
}

/**
 * The doors and windows, on the wall faces the camera can see.
 *
 * This is the one thing the elevated house has that the flat diagram cannot show, and the one that
 * makes it read as a building rather than as a block with a roof on it. Every number comes from the
 * document: the opening's own span along its wall, its `sillHeight`, which storey its `floorLevel`
 * puts it on, and `OPENING_HEIGHTS` for how tall its kind is. Nothing here is invented.
 *
 * **Only on a wall the camera can see.** An opening resolves to an outward normal, and a wall whose
 * normal points away is the back of the building — drawing its windows would put the far side's
 * glazing on the near side's wall, which is the class of mistake that makes a drawing quietly
 * untrustworthy. A wall seen edge-on has no face to draw on and is skipped by the same test.
 *
 * Note this runs *before* the roof, which is drawn lifted above it: an opening is on the wall, and
 * a roof that oversails hides the top of a tall one, exactly as it does in life.
 */
function drawWallOpenings(
  context: PlanContext,
  node: RenderHouseNode,
  toPx: (point: Point) => Point,
): void {
  const storeys = Math.max(1, node.house.house.storeys ?? 2);

  for (const { opening, segment, normal } of node.house.openings) {
    if (normal.y <= 0) continue;

    const bottom = (opening.floorLevel ?? 0) * STOREY_HEIGHT + (opening.sillHeight ?? 0);
    const top = bottom + (OPENING_HEIGHTS[opening.type] ?? 1.2);
    // An opening the building is not tall enough to hold is a stored state a resize can reach.
    if (top > storeys * STOREY_HEIGHT + 0.4) continue;

    const [a, b] = segment;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span <= 0) continue;

    const along = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const face = (t: number, height: number): Point => lift(along(t), height);

    // The frame: the whole opening, in one piece.
    context.fillStyle = FRAME_TONE;
    tracePath(context, [face(0, bottom), face(1, bottom), face(1, top), face(0, top)], toPx);
    context.fill();

    /* The glazing inside it, in panes. A 2.4 m run of bifolds is not one sheet of glass, and the
     * mullions are most of what tells a door from a painted panel at this size. */

    /*
     * **The frame is inset by the same width in two directions that are not the same scale.**
     *
     * Along the wall a metre is a metre. Up the wall a metre is `RISE` metres of screen, so a
     * 90 mm frame section inset by 90 mm of *height* lands at 19 mm on screen — a fifth of a pixel,
     * which is to say invisible, which is exactly what the first version drew. Dividing by `RISE`
     * asks for 90 mm **as seen**, which is what a frame has to be to read as one.
     */
    const insetAlong = Math.min(FRAME_WIDTH, span / 4);
    const insetUp = Math.min(FRAME_WIDTH / RISE, (top - bottom) / 4);
    const glassBottom = bottom + insetUp;
    const glassTop = top - insetUp;
    if (glassTop <= glassBottom) continue;

    const panes = Math.max(1, Math.round(span / MAX_PANE_WIDTH));
    const edge = insetAlong / span;

    context.fillStyle = GLAZING_TONE;
    for (let i = 0; i < panes; i += 1) {
      const from = edge + ((1 - 2 * edge) * i) / panes + (i > 0 ? edge / 2 : 0);
      const to = edge + ((1 - 2 * edge) * (i + 1)) / panes - (i < panes - 1 ? edge / 2 : 0);
      tracePath(
        context,
        [face(from, glassBottom), face(to, glassBottom), face(to, glassTop), face(from, glassTop)],
        toPx,
      );
      context.fill();
    }
  }
}

/**
 * A sprite that stands up: a tree, a bench, a light fitting.
 *
 * ## The interim, and why it is drawn this way
 *
 * With an elevated asset the placement is trivial and exact — the sprite's frame carries the
 * object's height above its own footprint, so it is drawn at its anchor and the picture is right.
 * Until that art exists the library holds a photograph taken from **directly above**, which is a
 * different thing: it is the whole object flattened onto its own footprint.
 *
 * Lifting such a photograph by half the object's height is the honest approximation. The object's
 * true silhouette runs from its footprint up to the footprint plus its lift, and the middle of that
 * band is where a flattened picture of it belongs. It reads as a thing standing up, stays attached
 * to the ground it stands on, and needs no new art — so every existing plan gains depth the moment
 * the view is switched on.
 *
 * **Except for anything drawn on a point.** A tree is a trunk on the recorded spot with a canopy
 * offset from it, and a shrub photograph is centred on its own stem; lifting either detaches it
 * from the ground it is standing on and, for a tree, from its own trunk. Those stay where they are
 * and get their depth from `trunkAndCanopy`'s parallax, which already exists.
 */
function drawObjectNode(
  context: PlanContext,
  node: RenderObjectNode,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  if (drawElevatedObject(context, node, pass, light, toPx)) return;

  const lift =
    node.item.element.shape.kind === 'point' ? 0 : liftPx(node.height / 2, pass.pxPerMetre);

  context.save();
  context.translate(0, -lift);
  drawItem(context, node.item, pass, light, toPx, rasterOrigin);
  context.restore();
}

/**
 * The real thing: an object drawn from art taken at the scene's own camera.
 *
 * Returns false when there is no elevated twin for this element, or its files have not been
 * generated, or it has not finished loading — all three being the same answer, which is what lets
 * the library arrive one family at a time and lets the whole app work with no library at all.
 *
 * The footprint handed to `elevatedPlacement` is the **geometry of record**, never the sprite's
 * natural size: a rect's own width and depth, a point's diameter. The asset is fitted inside that,
 * exactly as `spriteBox` has always fitted a plan sprite — what differs is only that an elevated
 * image is taller than its footprint, and `elevatedFrame` is where that is known.
 */
function drawElevatedObject(
  context: PlanContext,
  node: RenderObjectNode,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
): boolean {
  const { element } = node.item;
  const family = elevatedFamilyFor(element);
  if (!family) return false;

  const variants = pass.assets?.(family) ?? [];
  if (!variants.length) return false;
  const sprite = pick(variants, moduleRandom(element.id, 0, 0)());

  const { shape } = element;
  const footprint =
    shape.kind === 'rect'
      ? { width: shape.width, depth: shape.depth }
      : shape.kind === 'point'
        ? { width: shape.radius * 2, depth: shape.radius * 2 }
        : null;
  if (!footprint) return false;

  const placement = elevatedPlacement(family, elementAnchor(element), footprint);
  if (!placement) return false;

  /*
   * Free rotation for a rect, none for a point. A rect's rotation is a fact about the design — a
   * dining set laid along its terrace — and the face it turns is `height × RISE`, a few pixels of
   * shading. A point has no rotation of its own to honour.
   */
  const rotation = shape.kind === 'rect' ? (shape.rotation * Math.PI) / 180 : 0;

  drawElevatedSprite(context, sprite, placement, rotation, pass, light, toPx);
  return true;
}

/**
 * One elevated image: its contact shadow on the ground, then the picture standing on it.
 *
 * The shadow is drawn at the **anchor**, not at the middle of the image, and that is the whole
 * point of the anchor existing. A seven-metre tree's image is mostly canopy reaching up the screen;
 * a shadow centred on it would sit in mid-air, halfway up the trunk.
 */
function drawElevatedSprite(
  context: PlanContext,
  sprite: LoadedAsset,
  placement: ElevatedPlacement,
  rotation: number,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  const shadow = pass.assets?.(CONTACT_SHADOW_SPRITE)[0] ?? null;
  const foot = toPx(placement.pivot);

  if (shadow) {
    // Sized on the footprint the thing stands on, which is the width of its image.
    const radius = (placement.width / 2) * pass.pxPerMetre;
    const reach = radius * CONTACT_SHADOW_SCALE;
    const offset = radius * CONTACT_SHADOW_OFFSET_RATIO;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    context.drawImage(
      shadow.image as PatternCanvas,
      foot.x - light.x * offset - reach,
      foot.y - light.y * offset - reach,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  const at = toPx({ x: placement.x, y: placement.y });
  const width = placement.width * pass.pxPerMetre;
  const height = placement.height * pass.pxPerMetre;

  context.save();
  // Turned about where it stands, so the foot holds still whatever the rotation is.
  context.translate(foot.x, foot.y);
  context.rotate(rotation);
  context.translate(-foot.x, -foot.y);
  context.drawImage(sprite.image as PatternCanvas, at.x, at.y, width, height);
  context.restore();
}

/**
 * One instanced plant, lifted off the shadow it stands on.
 *
 * The shadow stays on the ground and the plant rises a little way off it, which is the whole trick:
 * the gap between the two *is* the height, and it costs one translate. Same reasoning as
 * `drawObjectNode`'s interim, applied to the thousands rather than to the tens.
 */
function drawPlantNode(
  context: PlanContext,
  node: RenderPlantNode,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  shadow: LoadedAsset | null,
): void {
  const { plant } = node;
  const at = toPx(plant.at);
  const radius = (plant.spread / 2) * pass.pxPerMetre;
  // Below a pixel and a half a plant is not a plant, it is noise on the ground it stands on.
  if (radius * 2 < MIN_DRAWN_UNIT_PX) return;

  const variants = plant.assetId ? (pass.assets?.(plant.assetId) ?? []) : [];
  const sprite = variants.find((asset) => asset.entry.variant === plant.variant) ?? variants[0];

  /*
   * The elevated path, when this plant's family has been drawn at the scene's own camera: the
   * image carries the plant's height above its own footprint, so it is placed on its anchor and
   * nothing is lifted. Falls through to the interim below for a plan sprite.
   */
  const placement = sprite
    ? elevatedPlacement(plant.assetId, plant.at, { width: plant.spread, depth: plant.spread })
    : null;
  if (sprite && placement) {
    drawElevatedSprite(context, sprite, placement, plant.rotation, pass, light, toPx);
    return;
  }

  const lift = liftPx(plant.height / 2, pass.pxPerMetre);

  /*
   * The shadow on the ground and the plant above it, drawn as two calls rather than one.
   *
   * `drawSprite` does both together at one point, which is right when a sprite lies flat on its own
   * footprint. Here the gap between them *is* the height, so they need different y values — and the
   * shadow must stay where the plant stands, not follow it up the screen.
   */
  if (shadow) {
    const reach = radius * CONTACT_SHADOW_SCALE;
    const offset = radius * CONTACT_SHADOW_OFFSET_RATIO;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    // The cast is the type being narrower than the runtime: `drawImage` takes both, and the
    // composer's own overload names only the canvas it composites layers from.
    context.drawImage(
      shadow.image as PatternCanvas,
      at.x - light.x * offset - reach,
      at.y - light.y * offset - reach,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  if (sprite) {
    drawSprite(context, sprite, null, at.x, at.y - lift, radius, plant.rotation, light);
    return;
  }

  drawBlob(context, {
    light,
    form: plant.blob.form,
    x: at.x,
    y: at.y - lift,
    radius,
    lobes: plant.blob.lobes,
    tone: cssToRgb(pick(plant.blob.palette, plant.tone)),
    random: moduleRandom(
      `${plant.blob.seed}:blob`,
      Math.round(plant.at.x * 100),
      Math.round(plant.at.y * 100),
    ),
  });
}

/**
 * Night, and the pools the fittings throw into it.
 *
 * Last of everything and clipped to the plot, because it is a property of the *scene* rather than
 * of any element in it: the wash has to fall on the house, the fence and the paving equally, and a
 * garden that darkened while its own boundary stayed at noon would read as a mistake rather than
 * as dusk. Clipped for the reason the shadow raster is — a plan that dimmed the neighbour's
 * property would be describing land it does not own.
 *
 * Draws nothing at all when `night` is null or zero, so every daylight sheet and every plan with
 * no location is byte-identical to what it was before lighting existed.
 */
function drawLighting(
  context: PlanContext,
  rendered: RenderScene,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const { night, lights, boundary } = rendered;
  if (night === null || night <= 0) return;

  context.save();
  tracePath(context, boundary, toPx);
  context.clip();

  context.globalAlpha = night * NIGHT_MAX_ALPHA;
  context.fillStyle = NIGHT_TONE;
  context.fill();
  context.globalAlpha = 1;

  const pool = pass.assets?.(LIGHT_POOL_SPRITE)[0];
  if (pool) {
    /*
     * `lighter` rather than `source-over`: two lamps on one shrub really are brighter than one, and
     * the pool tile is a pre-multiplied warm gradient so adding it lifts the wash back out instead
     * of painting a pale disc over it. The opposite of the shadow rule, deliberately — see
     * `LIGHT_POOL_ALPHA`.
     */
    context.globalCompositeOperation = 'lighter';
    for (const item of lights) {
      const centre = toPx(item.at);
      const reach = item.radius * pass.pxPerMetre;
      if (reach < 1) continue;

      context.globalAlpha = Math.max(0, Math.min(1, item.intensity)) * LIGHT_POOL_ALPHA;
      context.drawImage(
        pool.image as PatternCanvas,
        centre.x - reach,
        centre.y - reach,
        reach * 2,
        reach * 2,
      );
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  context.restore();
}

/**
 * Gates as gaps in the fence with the leaf standing open, and a kerb outside the street edge.
 * The same resolvers `GateMarks` draws from, so a sheet and the screen agree about the fence.
 */
function drawAccess(
  context: PlanContext,
  site: SiteSection,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  const street = streetEdge(site);
  const outward = streetOutward(site);
  if (street && outward) {
    const a = toPx({
      x: street[0].x + outward.x * STREET_KERB_OFFSET,
      y: street[0].y + outward.y * STREET_KERB_OFFSET,
    });
    const b = toPx({
      x: street[1].x + outward.x * STREET_KERB_OFFSET,
      y: street[1].y + outward.y * STREET_KERB_OFFSET,
    });
    context.save();
    context.setLineDash?.([8, 5]);
    context.lineWidth = 2;
    context.strokeStyle = COLOUR.measurement;
    context.globalAlpha = 0.8;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
    context.globalAlpha = 1;
  }

  for (const { gate, segment, inward } of resolvedGates(site)) {
    const from = toPx(segment[0]);
    const to = toPx(segment[1]);

    // The gap: the rail painted out in paper for the width of the opening.
    context.lineWidth = 6;
    context.lineCap = 'butt';
    context.strokeStyle = PLOT_GROUND;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();

    /*
     * What is hung in it, which is the whole difference between the three kinds — and the same
     * answer the canvas draws, because both ask `gateSwings`. This used to be worked out inline
     * here with its own arc loop, which always hinged the leaf on the segment's first end; a gate
     * and the same gate on an exported PNG could therefore open from opposite sides.
     */
    for (const swing of gateSwings(segment, inward, gate.kind)) {
      drawSwing(context, swing, COLOUR.fencePost, toPx);
    }

    if (gate.kind === 'open') {
      context.save();
      context.strokeStyle = COLOUR.fencePost;
      context.lineWidth = 1.5;
      context.setLineDash?.([4, 3]);
      for (const [tickFrom, tickTo] of openGapTicks(segment, inward)) {
        const a = toPx(tickFrom);
        const b = toPx(tickTo);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.restore();
    }
  }
}

/** Where the shadow layer is spliced in: after every fill, before every feature. */
export function firstFeatureIndex(elements: DesignElement[]): number {
  const index = elements.findIndex((element) => element.role === 'feature');
  return index === -1 ? elements.length : index;
}

/* ---------------------------------------------------------------- elements */

function drawItem(
  context: PlanContext,
  item: RenderItem,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { element, part, surface } = item;
  const { shape } = element;

  /*
   * A bed's neighbours are on its surface, not on the pass, because only the ground pass computes
   * them — and `null` there means "no opinion", so a caller that set its own exclusions keeps them.
   */
  const surfacePass: DrawPass = surface?.exclusions
    ? { ...pass, exclusions: surface.exclusions }
    : pass;

  if (part === 'ground') {
    drawSurface(context, surface, surfacePass, light, toPx, rasterOrigin);
    return;
  }
  if (part === 'object') {
    drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx);
    return;
  }

  if (shape.kind === 'point') {
    // A fire pit bowl or a parasol: a sprite on a point, before the drawn symbols get a look in.
    if (drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) return;
    drawPointSymbol(context, element, surface, pass, light, toPx, rasterOrigin);
    return;
  }

  if (!surface) return;

  /*
   * A path is its strip — the same ribbon the validator checks — painted like any other surface,
   * so stepping stones are stones set in grass rather than a grey stroke. It used to be a stroke,
   * which never reached the painter and drew every path as a flat lozenge.
   */
  if (shape.kind === 'polyline') {
    drawSurface(context, surface, surfacePass, light, toPx, rasterOrigin);
    return;
  }

  /*
   * Furniture is its sprite and nothing else: no surface under it, because the surface it stands
   * on is the element beneath. Only when the sprite is missing does it fall back to a flat block,
   * so a table is never invisible.
   */
  if (element.category === 'furniture') {
    if (!drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) {
      drawSurface(context, surface, surfacePass, light, toPx, rasterOrigin);
    }
    return;
  }

  drawSurface(context, surface, surfacePass, light, toPx, rasterOrigin);

  if (drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) return;

  if (element.category === 'structure' && shape.kind === 'rect') {
    // A structure with no symbol: the beams that told a pergola from a plain block before symbols.
    if (Math.min(shape.width, shape.depth) * pass.pxPerMetre >= MIN_STRUCTURE_DETAIL_PX) {
      context.strokeStyle = CATEGORY_COLOURS.structure.stroke;
      context.lineWidth = 1.5;
      for (const [from, to] of beamLines(shape.centre, shape.width, shape.depth, shape.rotation)) {
        const a = toPx(from);
        const b = toPx(to);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }
  }
}

/**
 * A surface: its material's pattern when it has one, a flat fill when it does not. Exactly the
 * pair of paths `ElementDrawing` takes, with the same painter behind the first.
 */
function drawSurface(
  context: PlanContext,
  surface: RenderSurface | null,
  pass: DrawPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  if (!surface) return;

  if (surface.material) {
    drawSurfacePattern(
      context,
      surface.outline,
      surface.material,
      surface.anchor,
      surface.seed,
      {
        pxPerMetre: pass.pxPerMetre,
        light,
        assets: pass.assets,
        makeCanvas: pass.makeCanvas,
        // A path lays its stepping stones along its own line, not across its bounding box.
        centreline: surface.centreline ?? undefined,
        // A bed's planting scheme is a property of the bed, so the layer stack needs the element.
        element: surface.element,
        layers: surface.layers,
        exclusions: pass.exclusions,
        cutEdge: surface.cutEdge ?? undefined,
      },
      rasterOrigin,
    );
  } else {
    tracePath(context, surface.outline, toPx);
    context.fillStyle = materialFill(surface.element);
    context.fill();
  }

  // Selection outlines belong to the editor overlay, not the rendered material.
}

/** The point symbols, from the same pure geometry the Konva `PointSymbol` draws. */
function drawPointSymbol(
  context: PlanContext,
  element: DesignElement,
  surface: RenderSurface | null,
  pass: DrawPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { shape } = element;
  if (shape.kind !== 'point') return;

  const { pxPerMetre } = pass;
  const centre = toPx(shape.at);
  const radiusPx = shape.radius * pxPerMetre;

  if (radiusPx < 8) {
    context.beginPath();
    context.arc(centre.x, centre.y, Math.max(MIN_DRAWN_SYMBOL_PX, radiusPx), 0, Math.PI * 2);
    context.fillStyle = materialFill(element);
    context.fill();
    return;
  }

  if (element.category === 'planting-bed') {
    const canopies = pass.assets
      ? canopiesForSymbol(element.symbol, element.plantId).flatMap((id) => pass.assets!(id))
      : [];
    if (canopies.length > 0) {
      const shadow = pass.assets!(CONTACT_SHADOW_SPRITE)[0] ?? null;
      drawCanopySprite(context, element, canopies, shadow, centre, radiusPx, light);
      return;
    }

    const tone = CATEGORY_COLOURS['planting-bed'];
    traceCurve(context, canopyRing(shape.at, shape.radius, element.id), toPx);
    context.fillStyle = tone.fill;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = tone.stroke;
    context.stroke();

    traceCurve(context, canopyCrown(shape.at, shape.radius, element.id), toPx);
    context.globalAlpha = 0.22;
    context.fillStyle = '#ffffff';
    context.fill();
    context.globalAlpha = 1;
    return;
  }

  // The disc itself: the material over the circle the geometry tessellates it to.
  drawSurface(context, surface, pass, light, toPx, rasterOrigin);

  /*
   * The drawn bowl and flame stand in only while there is no fire-pit sprite to place: once the
   * bowl is a piece of furniture inside the bark circle, a glyph on the circle as well is two fire
   * pits drawn on one.
   */
  const bowlSprite = pass.assets?.(SYMBOL_SPRITES['fire-pit']!) ?? [];
  if (element.category === 'gravel-mulch' && bowlSprite.length === 0) {
    const { rim, flame } = firePitRings(shape.at, shape.radius);

    tracePath(context, rim, toPx);
    context.lineWidth = 1.5;
    context.strokeStyle = '#8a7358';
    context.stroke();

    traceCurve(context, flame, toPx, 0.2);
    context.fillStyle = '#e08a3c';
    context.fill();
  }
}

/**
 * A tree as a photographed canopy, inscribed in its radius and standing on a contact shadow.
 *
 * The same sprite the Konva canvas draws, from the same seeded choice, so a sheet and the screen
 * show the same tree. The shadow convention is the scatter painter's: proportional to the thing,
 * pushed away from the pass's light, never a claim about the time of day.
 */
function drawCanopySprite(
  context: PlanContext,
  element: DesignElement,
  canopies: LoadedAsset[],
  shadow: LoadedAsset | null,
  centre: Point,
  radiusPx: number,
  light: Point,
): void {
  const { shape } = element;
  if (shape.kind !== 'point') return;

  const box = canopySpriteBox(
    shape.at,
    radiusPx,
    element.id,
    canopies.length,
    (variant) => canopies[variant]?.entry.opaqueRadiusRatio ?? 1,
  );
  const sprite = canopies[box.variant]!;

  if (shadow) {
    const reach = radiusPx * CONTACT_SHADOW_SCALE;
    const offset = radiusPx * CONTACT_SHADOW_OFFSET_RATIO;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    context.drawImage(
      shadow.image as PatternCanvas,
      centre.x - light.x * offset - reach,
      centre.y - light.y * offset - reach,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  /*
   * The trunk, and the canopy nudged off it.
   *
   * A canopy drawn concentric with its own point is a green disc lying on the grass — nothing in
   * the drawing says the leaves are six metres up. A small dark trunk on the element's *recorded*
   * point, with the canopy shifted a little away from the light, reads as parallax and is the
   * oldest cue in landscape drawing. The trunk stays put and the canopy moves, never the reverse:
   * the point is where the placer put the tree and where the validator checked it.
   */
  const stand = trunkAndCanopy(centre, radiusPx, light);

  if (radiusPx >= MIN_TRUNK_PX) {
    context.beginPath();
    context.arc(stand.trunk.x, stand.trunk.y, stand.trunkRadius, 0, Math.PI * 2);
    context.fillStyle = TRUNK_TONE;
    context.fill();
  }

  const { width, height } = sprite.image;
  const scale = (box.halfWidth * 2) / Math.max(width, height);

  context.save();
  context.translate(stand.canopy.x, stand.canopy.y);
  context.rotate(box.rotation);
  context.drawImage(
    sprite.image as PatternCanvas,
    (-width * scale) / 2,
    (-height * scale) / 2,
    width * scale,
    height * scale,
  );
  context.restore();
}

/**
 * The roof: its planes shaded against the scene's light, then its ridge and hips creased over them.
 *
 * The shading spread is deliberately narrow. A roof drawn with strong plane-to-plane contrast
 * pulls the eye straight to the house, and the house is context — the subject is the garden. Just
 * enough separation to say "this is a pitched roof, and the light comes from over there".
 */
function drawRoof(
  context: PlanContext,
  roof: RenderRoof,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const tones = ROOF_TONES[roof.material];
  const base = cssToRgb(tones.base);
  const skin = loadSkin(ROOF_SKINS[roof.material], pass);

  for (const plane of roof.planes) {
    if (plane.outline.length < 3) continue;
    tracePath(context, plane.outline, toPx);
    context.fillStyle = rgbToCss(shiftBrightness(base, plane.lit * ROOF_PLANE_SHADING));
    context.fill();
    // Slate courses follow each eave, so rotated houses retain the same physical tile size.
    const a = toPx(plane.outline[0]!);
    const b = toPx(plane.outline[1]!);
    const edgeMetres = Math.hypot(
      plane.outline[1]!.x - plane.outline[0]!.x,
      plane.outline[1]!.y - plane.outline[0]!.y,
    );
    const scale = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(edgeMetres, 0.001);
    if (scale < 12 || roof.form === 'flat') continue;

    /*
     * The photographed covering, where one has loaded: `skin-roof-slate` was generated with the
     * elevated library and read by nothing until now, which is the same dead-tick fault these notes
     * keep catching. Tiled in the plane's **own** frame rather than in screen space, for the reason
     * `paintSkinnedFace` gives: a slate is 300 mm on every roof of every house at every rotation,
     * and tiling in screen space runs the courses across the drawing instead of along the eaves.
     *
     * The procedural courses below stay as the answer when nothing has loaded, which is every
     * environment with no asset library — including the golden tests, which is why they are
     * unchanged by this.
     */
    if (skin && paintSkinnedPlane(context, plane, skin, base, toPx)) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const local = plane.outline.map((point) => {
      const p = toPx(point);
      return {
        x: (p.x - a.x) * Math.cos(angle) + (p.y - a.y) * Math.sin(angle),
        y: -(p.x - a.x) * Math.sin(angle) + (p.y - a.y) * Math.cos(angle),
      };
    });
    context.save();
    tracePath(context, plane.outline, toPx);
    context.clip();
    context.translate(a.x, a.y);
    context.rotate(angle);
    const tw = scale * 0.32;
    const th = scale * 0.2;
    const left = Math.floor(Math.min(...local.map((p) => p.x)) / tw) - 1;
    const right = Math.ceil(Math.max(...local.map((p) => p.x)) / tw);
    const top = Math.floor(Math.min(...local.map((p) => p.y)) / th);
    const bottom = Math.ceil(Math.max(...local.map((p) => p.y)) / th);
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const random = moduleRandom(`roof:${roof.material}`, col, row);
        const shade = plane.lit * ROOF_PLANE_SHADING + (random() - 0.5) * 0.055;
        const x = (col + Math.abs(row % 2) * 0.5) * tw;
        const y = row * th;
        context.fillStyle = rgbToCss(shiftBrightness(base, shade));
        context.fillRect(x, y, tw, th);
        context.fillStyle = 'rgba(20,27,31,0.24)';
        context.fillRect(
          x,
          y + th - Math.max(0.45, scale * 0.012),
          tw,
          Math.max(0.45, scale * 0.012),
        );
        context.fillRect(x, y, Math.max(0.3, scale * 0.008), th);
        context.fillStyle = 'rgba(220,226,230,0.08)';
        context.fillRect(x, y, tw, Math.max(0.3, scale * 0.006));
      }
    }
    context.restore();
  }

  drawRooflights(context, roof, base, toPx);
  drawFascia(context, roof, base, toPx);

  /*
   * The ridge and the hips as **capping**, not as a line.
   *
   * A ridge is a course of half-round tiles sitting proud of both slopes, so it is a narrow band
   * with its own light on top and its own shadow beneath — which is what tells the eye that two
   * planes meet at an apex rather than that somebody drew a line on a flat surface. Drawn as a
   * thick stroke with a highlight inside it, because a ridge at plan scale is two or three pixels
   * across and a filled band that narrow is worse than a stroke, not better.
   */
  context.lineCap = 'round';
  for (const [from, to] of roof.ridge) {
    const a = toPx(from);
    const b = toPx(to);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);

    /* The shadow the capping throws on the slopes either side of it, first and widest. */
    context.strokeStyle = 'rgba(18,24,28,0.30)';
    context.lineWidth = 4.4;
    context.stroke();

    context.strokeStyle = tones.ridge;
    context.lineWidth = 2.8;
    context.stroke();

    /* And the light along the top of the capping itself. */
    context.strokeStyle = 'rgba(214,224,228,0.38)';
    context.lineWidth = 0.9;
    context.stroke();
  }
}

/**
 * The covering, tiled in the plane's own frame. Returns false when the tile is too small to read.
 *
 * A roof plane is a genuine plan-space polygon — unlike a wall face, which the lift shears — so the
 * frame here is an honest translate, rotate and scale rather than a matrix. One unit inside it is
 * one metre along the eaves and one metre up the slope.
 */
function paintSkinnedPlane(
  context: PlanContext,
  plane: RenderRoof['planes'][number],
  skin: FaceSkin,
  base: { r: number; g: number; b: number },
  toPx: (point: Point) => Point,
): boolean {
  const { metres } = skin;
  if (metres.w <= 0 || metres.h <= 0) return false;

  const [start, end] = plane.outline as [Point, Point];
  const run = Math.hypot(end.x - start.x, end.y - start.y);
  if (run <= 0) return false;

  const from = toPx(start);
  const to = toPx(end);
  const scale = Math.hypot(to.x - from.x, to.y - from.y) / run;
  if (metres.h * scale < MIN_SKINNED_FACE_PX) return false;

  const extent = plane.outline.reduce(
    (most, point) => Math.max(most, Math.hypot(point.x - start.x, point.y - start.y)),
    0,
  );

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;

  context.save();
  tracePath(context, plane.outline, toPx);
  context.clip();
  /* One unit along the eaves, one unit up the slope — rotation and scale in one matrix, because
   * `PatternContext` carries `transform` and deliberately not `scale`. */
  context.transform(cos, sin, -sin, cos, from.x, from.y);

  const columns = Math.ceil(extent / metres.w) + 1;
  const rows = Math.ceil(extent / metres.h) + 1;
  for (let column = -1; column < columns; column += 1) {
    for (let row = -rows; row < rows; row += 1) {
      // The cast is the type being narrower than the runtime, as everywhere else in this file.
      context.drawImage(
        skin.image as PatternCanvas,
        column * metres.w,
        row * metres.h,
        metres.w,
        metres.h,
      );
    }
  }

  context.restore();

  /* The light, over the photograph: the skin is flat because only the renderer knows the slope. */
  context.save();
  tracePath(context, plane.outline, toPx);
  context.globalAlpha = FACE_SKIN_TINT;
  context.fillStyle = rgbToCss(shiftBrightness(base, plane.lit * ROOF_PLANE_SHADING));
  context.fill();
  context.restore();
  return true;
}

/**
 * The rooflights, as glass rather than as holes.
 *
 * A dark rectangle with a lit frame round it: glass seen from above is the sky, which is brighter
 * than any slate, so the pane is drawn *light* and the frame dark. Getting that the wrong way round
 * — which the first version did — draws something that reads as a hole in the roof.
 */
function drawRooflights(
  context: PlanContext,
  roof: RenderRoof,
  base: { r: number; g: number; b: number },
  toPx: (point: Point) => Point,
): void {
  for (const light of roof.rooflights) {
    /* The frame first, and the pane inside it — so the glass never touches the slate directly. */
    tracePath(context, light, toPx);
    context.fillStyle = rgbToCss(shiftBrightness(base, -0.3));
    context.fill();

    context.save();
    tracePath(context, light, toPx);
    context.clip();
    context.globalAlpha = 0.85;
    context.fillStyle = ROOFLIGHT_GLASS;
    tracePath(context, insetPolygon(light, ROOFLIGHT_FRAME) ?? light, toPx);
    context.fill();
    context.restore();
  }
}

/**
 * What glass looks like from above: the sky, which is paler and cooler than any roof covering.
 *
 * Drawn *light*, which is the version that reads. The first attempt filled the pane darker than the
 * slate round it on the reasoning that a window is a dark opening — true of a wall, false of a roof,
 * and what it actually drew was two holes punched through the building.
 */
const ROOFLIGHT_GLASS = '#aebfc9';

/** The frame round a rooflight, in metres. A real one is about this. */
const ROOFLIGHT_FRAME = 0.09;

/**
 * The fascia: the board closing the ends of the rafters, drawn as a line round the eaves.
 *
 * It is the edge of the roof, and a roof with no edge reads as a pattern painted on the ground. A
 * hair darker than the covering rather than black, because at 1:100 a hard outline round the house
 * makes the building the loudest object in a drawing whose subject is the garden.
 */
function drawFascia(
  context: PlanContext,
  roof: RenderRoof,
  base: { r: number; g: number; b: number },
  toPx: (point: Point) => Point,
): void {
  if (roof.eaves.length < 3) return;
  tracePath(context, roof.eaves, toPx);
  context.lineWidth = 1.6;
  context.lineJoin = 'round';
  context.strokeStyle = rgbToCss(shiftBrightness(base, -0.3));
  context.stroke();
}

/** How far a fully lit roof plane moves from a fully shaded one. See `drawRoof`. */
const ROOF_PLANE_SHADING = 0.14;

/* ---------------------------------------------------------------- planting */

/**
 * The render-only planting, drawn above the ground rather than inside it.
 *
 * Two things here are the whole point of instanced planting, and both are consequences of *not*
 * being inside `clip(bed.outline)`:
 *
 * - **Plants overlap.** Foliage crosses its bed's edge and spills onto the lawn beside it, and
 *   neighbouring crowns run into one another, which is what turns a scatter of icons into a mass.
 * - **They stack.** Drawn in `visualLayer` order, so ground cover goes down first and the shrubs
 *   close over it, rather than every plant being one flat texture in one flat surface.
 *
 * They are still clipped to the *plot* — the caller's clip is in force — which is the same rule
 * the cast-shadow raster follows: a garden plan may not draw over land it does not own.
 *
 * Empty in `'baked'` mode, so the 2D Plan drawing is untouched by any of this.
 */
/**
 * A plant sprite carried towards its bed's palette, or the photograph untouched.
 *
 * The tint was applied inside `resolveAssets`, on the *raster* path only — so from the moment
 * planting became sprites the palette stopped reaching it, and the tonal ladder `tones.ts` was
 * tuned to produce (a hedge darker and tighter than shrubs, shrubs darker than a mixed border)
 * existed nowhere in the picture. Every bed was whatever green the photographs happened to be.
 *
 * Gated on `recolourable`, which is exactly the flag's meaning: the plan families were written
 * neutral and flatly lit *so that* a multiply could carry them, and the elevated ones carry their
 * own light and must never be tinted. Shared with Pixi through `tintSprite`'s cache, so the two
 * backends tint the same pixels rather than agreeing by arithmetic.
 */
export function plantTint(
  sprite: LoadedAsset,
  plant: RenderPlant,
  makeCanvas: MakeCanvas | undefined,
): LoadedAsset {
  if (!isRecolourable(sprite.entry.id) || plant.blob.palette.length === 0) return sprite;
  return tintSprite(sprite, pick(plant.blob.palette, plant.tone), SPRITE_TINT, makeCanvas);
}

function drawPlants(
  context: PlanContext,
  rendered: RenderScene,
  pass: PlanPass,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  if (rendered.plants.length === 0) return;

  const shadow = pass.assets?.(CONTACT_SHADOW_SPRITE)[0] ?? null;
  const ordered = [...rendered.plants].sort(
    (a, b) => LAYER_ORDER[a.visualLayer] - LAYER_ORDER[b.visualLayer],
  );

  for (const plant of ordered) {
    const at = toPx(plant.at);
    const radius = (plant.spread / 2) * pass.pxPerMetre;
    // Below a pixel and a half a plant is not a plant, it is noise on the ground it stands on.
    if (radius * 2 < MIN_DRAWN_UNIT_PX) continue;

    const variants = plant.assetId ? (pass.assets?.(plant.assetId) ?? []) : [];
    const sprite = variants.find((asset) => asset.entry.variant === plant.variant) ?? variants[0];

    if (sprite) {
      /*
       * The same height rule the primitive path applies, and it has to be stated in both or the
       * exported PNG carries the flat grey wash the screen has just stopped drawing. A mat has
       * nothing standing off the ground to cast; see `MIN_CONTACT_SHADOW_HEIGHT`.
       */
      const grounded = plant.height >= MIN_CONTACT_SHADOW_HEIGHT ? shadow : null;
      drawSprite(context, plantTint(sprite, plant, pass.makeCanvas), grounded, at.x, at.y, radius,
        plant.rotation, light);

      /*
       * The flower on top, concentric and unturned. Unturned because a bloom seen from above has no
       * orientation worth claiming, and turning it with the plant would make the same flower head
       * point four ways across a drift and read as four species.
       */
      if (plant.flower) {
        const bloom = pass.assets?.(plant.flower.assetId) ?? [];
        const head = bloom[Math.floor(plant.tone * bloom.length)] ?? bloom[0];
        if (head) drawSprite(context, head, null, at.x, at.y, radius * plant.flower.scale, 0, light);
      }
      continue;
    }

    /*
     * No sprite: the drawn blob, from the same spatially hashed generator the surface painter
     * uses, so a plant keeps its outline when its neighbours change and the two modes agree
     * about what an un-assetted garden looks like.
     */
    drawBlob(context, {
      light,
      form: plant.blob.form,
      x: at.x,
      y: at.y,
      radius,
      lobes: plant.blob.lobes,
      tone: cssToRgb(pick(plant.blob.palette, plant.tone)),
      random: moduleRandom(
        `${plant.blob.seed}:blob`,
        Math.round(plant.at.x * 100),
        Math.round(plant.at.y * 100),
      ),
    });
  }
}

/* ---------------------------------------------------------------- shadows */

/**
 * The cast-shadow layer, at the same seam the canvases splice it in.
 *
 * Drawn into a canvas of its own and composited once, for the reason `SHADOW_TONE` gives: two
 * overlapping shadows are one shadow, and only an opaque layer drawn at a single opacity gets
 * that right. The sub-canvas covers the plot, not the shadows, so the frame the sheets draw at
 * 09:00 and the one at 19:00 have their pixels in the same places.
 */
/**
 * The shade where surfaces meet, at the same seam the canvases splice it in.
 *
 * Above the ground and its courses, below the cast shadows and everything that stands up: it is a
 * property of the ground itself, so a tree's shadow falls across it and a shrub stands on it.
 * Exported through `seamOutlines` rather than read off the elements here, so the composer and Pixi
 * darken the same edges.
 */
export function seamOutlines(scene: RenderScene): Point[][] {
  return scene.passes.seams.flatMap((primitive) =>
    primitive.kind === 'seam' ? [primitive.outline] : [],
  );
}

function drawSeams(
  context: PlanContext,
  rendered: RenderScene,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const raster = renderSeamLayer(seamOutlines(rendered), rendered.boundary, {
    pxPerMetre: pass.pxPerMetre,
    makeCanvas: pass.makeCanvas,
  });
  if (!raster) return;

  const at = toPx(raster.originMetres);
  const scale = pass.pxPerMetre / raster.pxPerMetre;
  context.globalAlpha = SEAM_SHADE_OPACITY;
  context.drawImage(raster.canvas, at.x, at.y, raster.widthPx * scale, raster.heightPx * scale);
  context.globalAlpha = 1;
}

function drawShadows(
  context: PlanContext,
  rendered: RenderScene,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const { cast, occluders } = rendered.shadows;
  if (!cast) return;
  if (occluders.length === 0) return;

  const raster = renderShadowLayer(occluders, cast, rendered.boundary, {
    pxPerMetre: pass.pxPerMetre,
    makeCanvas: pass.makeCanvas,
    /*
     * Soft in both views. _This reverses_ "soft is Visualise's presentation choice; a diagram draws
     * the hard edge" — the plan is a drawing of a garden rather than a section through one, and the
     * hard edge was the most conspicuous thing separating it from a professional plan. The number
     * is a switch: the blur actually applied comes from each occluder's character and height.
     */
    softnessMetres: PRESENTATION_SHADOW_SOFTNESS,
  });
  if (!raster) return;
  const at = toPx(raster.originMetres);
  const scale = pass.pxPerMetre / raster.pxPerMetre;
  context.globalAlpha = SHADOW_OPACITY;
  context.drawImage(raster.canvas, at.x, at.y, raster.widthPx * scale, raster.heightPx * scale);
  context.globalAlpha = 1;
}

/* ---------------------------------------------------------------- property */

/**
 * The house as a building: a wall of real thickness round a floor, the way `HouseShape` draws it.
 * The outline is the geometry of record; the inset is derived here, every time.
 */
function drawHouse(
  context: PlanContext,
  rendered: RenderHouse,
  pass: PlanPass,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
  elevated: boolean,
): void {
  const { outline, interior } = rendered;

  /*
   * The shadow first, so the building stands on the garden rather than beside it. Drawn here
   * rather than in the cast-shadow layer because it is unconditional — the cast layer only exists
   * when the plan knows where on Earth it is, and a house has to look like a house either way.
   */
  if (pass.contactShadows !== false) {
    context.save();
    context.globalAlpha = HOUSE_SHADOW_ALPHA;
    tracePath(context, houseGroundShadow(outline, pass.light ?? LIGHT_DIRECTION), toPx);
    context.fillStyle = SHADOW_TONE;
    context.fill();
    context.restore();
  }

  /*
   * A roof, where there is one: Visualise only. A flat grey rectangle is parsed by the eye as
   * another paved surface, so the drawing loses the one object that gives the garden its scale
   * and its orientation. The planes are drawn inside the footprint — never over it — so nothing
   * here can make a legal house look as though it leaves the plot.
   */
  if (rendered.roof) {
    drawRoof(context, rendered.roof, pass, toPx);
    tracePath(context, outline, toPx);
    context.lineWidth = 1.5;
    context.lineJoin = 'round';
    context.strokeStyle = COLOUR.houseStroke;
    context.stroke();
    /*
     * **No openings over a roof, and a threshold mark on the ground instead.**
     *
     * The first half is unchanged and still right: from directly above a roof you cannot see the
     * doors beneath it, and drawing them on the slopes would be the one place this renderer told a
     * lie about what you are looking at. In Visualise the walls carry them (`drawWallOpenings`),
     * where you genuinely can see them.
     *
     * But the plan has a roof now too, and the door is the single most layout-determining object in
     * a garden drawing — it is what the terrace is laid across and what every path starts from. A
     * plan that hides it under the roof loses the one thing the composition is organised around. So
     * the ground outside the building gets a threshold mark, which is what a landscape drawing does
     * and what the reference does: you are not shown the door, you are shown where you come out.
     */
    if (!elevated) drawThresholds(context, rendered, pxPerMetre, toPx);
    return;
  }

  tracePath(context, outline, toPx);
  context.fillStyle = interior ? COLOUR.houseWall : COLOUR.houseFill;
  context.fill();
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.strokeStyle = COLOUR.houseStroke;
  context.stroke();

  if (!interior) return;

  /*
   * The inside of the building, left deliberately plain.
   *
   * This used to be tiled with a photograph of pale oak flooring. A landscape plan does not show a
   * building's interior finishes, and drawing one had a specific cost: the eye parsed a large
   * warm-toned timber field as another garden surface — a deck — so the house became the brightest
   * and most textured object in a drawing whose subject is the garden. A quiet neutral recedes,
   * which is the whole job. The wall band round it is what says "building", and the openings drawn
   * into that band are what the layout grammar reads.
   */
  tracePath(context, interior, toPx);
  context.fillStyle = COLOUR.houseFill;
  context.fill();

  drawOpenings(context, rendered.openings, pxPerMetre, toPx);
}

/**
 * Where you come out of the house, drawn on the ground rather than on the building.
 *
 * A short bar across the doorway with the swing beside it, laid on the garden just outside the
 * wall — the convention a landscape drawing uses when the roof is shown, and what the reference
 * plan does. It carries the two facts the garden needs: which opening you can actually walk
 * through, and how wide it is.
 *
 * **Ground-floor doors only.** A window is not a way out and an upstairs opening is not one either,
 * so neither gets a mark: a bar under every window would draw a dozen thresholds on a house with
 * one door and say nothing about where the terrace goes.
 *
 * Nothing here measures anything. `openingSegment` and `openingNormal` are the same resolvers the
 * generator reads, so the mark cannot disagree with the door the design was composed around.
 */
function drawThresholds(
  context: PlanContext,
  rendered: RenderHouse,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  for (const { opening, segment, normal } of rendered.openings) {
    if (opening.floorLevel > 0) continue;
    if (opening.type === 'window' || opening.type === 'upper-window') continue;

    const [start, end] = segment;
    /* Clear of the eaves, so the mark is on the garden rather than under the roof. */
    const out = (point: Point): Point => ({
      x: point.x + normal.x * THRESHOLD_STANDOFF,
      y: point.y + normal.y * THRESHOLD_STANDOFF,
    });

    const from = toPx(out(start));
    const to = toPx(out(end));

    context.save();
    context.lineCap = 'butt';

    /* A pale bar first, so the mark reads on dark paving as well as on grass. */
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = Math.max(4, 0.16 * pxPerMetre);
    context.strokeStyle = 'rgba(248,250,246,0.85)';
    context.stroke();

    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = Math.max(2, 0.07 * pxPerMetre);
    context.strokeStyle = COLOUR.houseStroke;
    context.stroke();

    if (opening.swing !== 'none') {
      const swing = swingGeometry(out(start), out(end), normal, opening.swing === 'inward');
      if (swing) drawSwing(context, swing, COLOUR.houseStroke, toPx);
    }

    context.restore();
  }
}

/** How far outside the wall a threshold mark is laid, in metres. Clear of any eaves. */
const THRESHOLD_STANDOFF = 0.12;

/**
 * The doors and windows, cut into the wall band.
 *
 * A port of `HouseOpenings`, so a sheet and the screen agree about where you step out of the
 * house. Until this existed the composer drew none of them: a patio door was visible on step 1 and
 * absent from every thumbnail, PNG export and judging sheet of the same plan — which is exactly
 * backwards, since the door is the single most layout-determining object in the drawing and the
 * sheets are what the design gets judged on.
 */
function drawOpenings(
  context: PlanContext,
  openings: RenderOpening[],
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  for (const { opening, segment, normal } of openings) {
    const [start, end] = segment;
    const glazed = opening.type === 'window' || opening.type === 'upper-window';

    context.save();
    // Upstairs openings are drawn faintly: they are real, but nothing walks out of one.
    if (opening.floorLevel > 0) context.globalAlpha = 0.35;

    /*
     * The cut runs half a wall in from the line the opening sits on and is exactly one wall
     * thick, because the drawn wall is a band *inside* the outline — a stroke centred on the
     * outline would cut half of itself into the garden.
     */
    const half = WALL_THICKNESS / 2;
    const gapFrom = toPx({ x: start.x - normal.x * half, y: start.y - normal.y * half });
    const gapTo = toPx({ x: end.x - normal.x * half, y: end.y - normal.y * half });
    const from = toPx(start);
    const to = toPx(end);

    context.lineCap = 'butt';

    /*
     * A window is not a hole you walk through, so it is not drawn as one: the wall carries on past
     * it and two fine lines cross the band. Drawn as a gap, every window read as a doorway.
     */
    if (!glazed) {
      context.beginPath();
      context.moveTo(gapFrom.x, gapFrom.y);
      context.lineTo(gapTo.x, gapTo.y);
      context.lineWidth = Math.max(3, WALL_THICKNESS * pxPerMetre + 1);
      context.strokeStyle = COLOUR.houseFill;
      context.stroke();
    }

    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = 2.5;
    context.strokeStyle = COLOUR.handle;
    context.stroke();

    if (glazed) {
      context.beginPath();
      context.moveTo(gapFrom.x, gapFrom.y);
      context.lineTo(gapTo.x, gapTo.y);
      context.lineWidth = 1.5;
      context.stroke();
    }

    if (opening.swing !== 'none') {
      const swing = swingGeometry(start, end, normal, opening.swing === 'inward');
      if (swing) drawSwing(context, swing, COLOUR.houseStroke, toPx);
    }

    context.restore();
  }
}

/** A leaf standing open and the arc it sweeps. One drawing, from `swingGeometry`'s one answer. */
function drawSwing(
  context: PlanContext,
  swing: SwingGeometry,
  stroke: string,
  toPx: (point: Point) => Point,
): void {
  context.save();
  context.strokeStyle = stroke;

  context.beginPath();
  swing.arc.forEach((point, index) => {
    const at = toPx(point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.lineWidth = 1;
  context.globalAlpha = 0.7;
  context.setLineDash?.([3, 3]);
  context.stroke();

  // The leaf itself, solid, so the arc reads as the path it swept rather than as a shape.
  context.setLineDash?.([]);
  context.globalAlpha = 1;
  const hinge = toPx(swing.hinge);
  const open = toPx(swing.open);
  context.beginPath();
  context.moveTo(hinge.x, hinge.y);
  context.lineTo(open.x, open.y);
  context.lineWidth = 1.5;
  context.stroke();

  context.restore();
}

/** Post spacing along the fence, in metres — the same figure `FenceLine` defaults to. */
export const FENCE_POST_SPACING = 1.8;

/**
 * The boundary as a fence: a rail with posts at real intervals, dropped when they would crowd.
 * A port of `FenceLine`, so a sheet and the screen agree about what the edge of the garden is.
 */
function drawFence(
  context: PlanContext,
  boundary: Point[],
  runs: BoundaryRun[],
  pxPerMetre: number,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  // The shade under the panels the sun is behind, clipped to the plot like everything else.
  context.save();
  tracePath(context, boundary, toPx);
  context.clip();
  context.globalAlpha = FENCE_SHADE_OPACITY;
  context.fillStyle = COLOUR.fenceShade;
  for (const band of fenceShadeBands(boundary, light)) {
    tracePath(context, band, toPx);
    context.fill();
  }
  context.globalAlpha = 1;
  context.restore();

  /*
   * Per run, so a plot with a wall on one side and railings on another draws as that plot. The
   * geometry and the palette both come from `symbols/boundary.ts`, shared with `FenceLine` — two
   * renderers working the same thing out separately is exactly how they drift.
   */
  const clockwise = ringIsClockwise(boundary);

  for (const run of runs) {
    const palette = BOUNDARY_PALETTE[run.kind];
    const inward = inwardNormal(run, clockwise);
    const bandPx = run.thickness * pxPerMetre;
    const asLine = palette.dashed || bandPx < MIN_BAND_PX;

    if (asLine) {
      context.beginPath();
      const from = toPx(run.start);
      const to = toPx(run.end);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.lineWidth = palette.dashed ? 1.5 : 2.5;
      context.lineJoin = 'round';
      context.strokeStyle = palette.body;
      context.stroke();
    } else {
      tracePath(context, boundaryBand(run, inward), toPx);
      context.fillStyle = palette.body;
      context.fill();

      drawBoundaryRelief(context, run, inward, light, pxPerMetre, toPx);

      // A wall's coping: the light line along the top that says masonry rather than timber.
      if (palette.cap) {
        const inner = (point: Point) => ({
          x: point.x + inward.x * run.thickness,
          y: point.y + inward.y * run.thickness,
        });
        const from = toPx(inner(run.start));
        const to = toPx(inner(run.end));
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.lineWidth = Math.max(1, bandPx * 0.3);
        context.strokeStyle = palette.cap;
        context.stroke();
      }
    }

    if (!palette.detail) continue;

    const postRadius = Math.max(1.2, Math.min(3.2, pxPerMetre * 0.05));
    const posts = runPosts(
      run,
      pxPerMetre,
      { x: (inward.x * run.thickness) / 2, y: (inward.y * run.thickness) / 2 },
      crownInset(run),
    );

    context.fillStyle = palette.detail;

    for (const post of posts) {
      const at = toPx(post);

      if (run.kind === 'hedge') {
        // A hedge's "posts" are its crowns: round, overlapping, and read as one mass.
        const radius = Math.max(postRadius, bandPx / 2);
        context.save();
        context.globalAlpha = 0.75;
        context.beginPath();
        traceCircle(context, at, radius);
        context.fill();
        context.restore();
      } else {
        context.fillRect(at.x - postRadius, at.y - postRadius, postRadius * 2, postRadius * 2);
      }
    }
  }
}

/**
 * What tells you a boundary stands up, in a view that has no height: a lit edge and a cast band.
 *
 * The plan draws a boundary as the band it occupies on the ground, and a band is flat — so a 1.8 m
 * fence and a 1.1 m railing were the same drawing at different widths, and neither of them read as
 * anything but a line on the paper. Visualise has extrusions and faces to say it; the plan has only
 * conventions, and this is the one every drawn plan uses.
 *
 * **The spacing states the height.** The lit line runs along the edge the light comes from; the
 * shade falls on the ground on the far side of it, and how far it reaches is `height ×
 * CONVENTIONAL_SHADOW_RATIO` — the same ratio `conventionalCast` gives every other standing thing,
 * so a fence's mark and a shed's shadow agree about where the drawing's sun is. A railing's band is
 * a third of a fence's, and a 0.9 m wall's is half, which is the fact the drawing could not say.
 *
 * A **convention**, not a solar claim, in the `houseGroundShadow` and contact-disc class: it is
 * drawn whether or not the plan knows where on Earth it is, and it is withdrawn with the rest of
 * the shading when shadows are turned off.
 */
function drawBoundaryRelief(
  context: PlanContext,
  run: BoundaryRun,
  inward: Point,
  light: Point,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  if (run.height <= 0) return;

  /* Which side of the band the light falls on: +1 when it comes from outside the plot. */
  const facing = inward.x * light.x + inward.y * light.y;
  const lit = facing < 0 ? 0 : run.thickness;
  const shaded = facing < 0 ? run.thickness : 0;

  const at = (point: Point, offset: number): Point => ({
    x: point.x + inward.x * offset,
    y: point.y + inward.y * offset,
  });

  /* The shade the run throws on the ground beside it, away from the light. */
  const reach = run.height * CONVENTIONAL_SHADOW_RATIO;
  const sign = facing < 0 ? 1 : -1;
  const band = [
    at(run.start, shaded),
    at(run.end, shaded),
    at(run.end, shaded + reach * sign),
    at(run.start, shaded + reach * sign),
  ];

  context.save();
  context.globalAlpha = BOUNDARY_RELIEF_SHADE;
  context.fillStyle = SHADOW_TONE;
  tracePath(context, band, toPx);
  context.fill();
  context.restore();

  /* And the light along the top edge the sun reaches, which is what gives the band a thickness. */
  const from = toPx(at(run.start, lit));
  const to = toPx(at(run.end, lit));
  context.save();
  context.globalAlpha = BOUNDARY_RELIEF_LIGHT;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.lineWidth = Math.max(0.8, Math.min(2.4, run.thickness * pxPerMetre * 0.35));
  context.lineCap = 'butt';
  context.strokeStyle = '#f4f7f2';
  context.stroke();
  context.restore();
}

/** How dark the band a boundary throws is, and how bright its lit edge. Conventions, both. */
const BOUNDARY_RELIEF_SHADE = 0.16;
const BOUNDARY_RELIEF_LIGHT = 0.5;

/** A circle as a path, for the hedge crowns. The context has no `arc`, so it is traced. */
function traceCircle(context: PlanContext, centre: Point, radius: number): void {
  const segments = 12;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = centre.x + Math.cos(angle) * radius;
    const y = centre.y + Math.sin(angle) * radius;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/* ---------------------------------------------------------------- paths */

function tracePath(context: PatternContext, ring: Point[], toPx: (point: Point) => Point): void {
  context.beginPath();
  ring.forEach((point, index) => {
    const at = toPx(point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.closePath();
}

/**
 * A closed ring through its points as a smooth curve — what Konva's `tension` does to a `Line`.
 *
 * Quadratic curves through the midpoints between successive vertices, which is a simpler spline
 * than Konva's Catmull-Rom but rounds the same lobes. The canopy is a symbol, not geometry, so the
 * two drawings need to agree in character rather than in pixels.
 */
function traceCurve(
  context: PatternContext,
  ring: Point[],
  toPx: (point: Point) => Point,
  tension = 0.35,
): void {
  if (ring.length < 3) return;
  const points = ring.map(toPx);
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  context.beginPath();
  const start = mid(points[points.length - 1]!, points[0]!);
  context.moveTo(start.x, start.y);

  for (let i = 0; i < points.length; i += 1) {
    const control = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const end = mid(control, next);
    // Tension pulls the curve towards the vertex; 0 would run straight between midpoints.
    const cx = end.x + (control.x - end.x) * (0.5 + tension);
    const cy = end.y + (control.y - end.y) * (0.5 + tension);
    context.quadraticCurveTo(cx, cy, end.x, end.y);
  }

  context.closePath();
}
