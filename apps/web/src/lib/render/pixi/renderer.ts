import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Point } from '@garden-studio/schema';
import { assetVersion, getAssetVariants } from '../../materials/assets/registry';
import { CONTACT_SHADOW_SPRITE } from '../../materials/assets/material-assets';
import { PRESENTATION_SHADOW_SOFTNESS } from '../../materials/render-shadow-layer';
import { getSurfacePattern } from '../../materials/pattern-cache';
import { getShadowLayer } from '../../materials/shadow-cache';
import type { MakeCanvas, PatternCanvas } from '../../materials/render-surface-pattern';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  SHADOW_OPACITY,
} from '../../materials/light';
import { drawStackNode, PLOT_GROUND, type PlanContext, type PlanPass } from '../../materials/render-plan';
import type { RenderNode, RenderPlant, RenderScene, RenderSurface, VisualLayer } from '../scene';
import { LAYER_ORDER } from '../visual-layer';
import { RISE } from '../camera';
import { elevatedPlacement } from '../../materials/symbols/elevated';

/**
 * Original WebGL backend retained for baseline profiling. The active SceneRenderer is re-exported
 * from compositor.ts below; do not add new design contributions to this legacy implementation.
 *
 * ## What it is, and what it deliberately is not
 *
 * It is a **compositor**, not a second painter. Every surface it draws is a raster produced by the
 * existing Canvas2D painter — `renderSurfacePattern`, through the same `getSurfacePattern` cache
 * the Konva canvas uses — uploaded as a texture. So the two-thousand-odd lines of slab, board,
 * scatter, hedge and water painting are reused unchanged, and there is no second implementation of
 * a material to drift from the first. That is what keeps this file small.
 *
 * What WebGL is actually here for is the part Canvas2D is bad at: a mature garden is a few
 * thousand plant sprites, and Visualise is a view the user pans, zooms and drags a maturity slider
 * through. Pixi batches same-texture sprites into a handful of draw calls, so the sprite count
 * stops mattering. A one-shot still render never needed this; an interactive view does.
 *
 * ## Verification
 *
 * Pixi v8 has no supported Node backend, so the browser compositor is tested with Playwright.
 * Under Vitest,
 * `buildRenderScene` is a pure function tested on its own: every decision about *what* to draw is
 * asserted before a renderer sees it, and this file is left with nothing to be wrong about except
 * paint. The Canvas2D backend stays the reference for the judging sheets.
 */

/** Where the camera is: metres per screen, and which world point is in the middle. */
export interface ViewTransform {
  pxPerMetre: number;
  /** Diagnostic comparison; only affects eligible low planting, not authored geometry. */
  plantingPreview?: import('../plant-clusters').PlantingPreview;
  /** World point at the centre of the viewport. */
  centre: Point;
}

/**
 * The viewport in CSS pixels.
 *
 * Passed in rather than measured here so that the WebGL layer and the 2D overlay drawn over it
 * take their frame from one measurement of one element. Device pixel ratio is the renderer's own
 * business and must not reach this.
 */
export interface ViewSize {
  width: number;
  height: number;
}

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

/** Layer containers, created once in stacking order so a sprite only has to name its layer. */
const LAYERS: VisualLayer[] = (Object.keys(LAYER_ORDER) as VisualLayer[]).sort(
  (a, b) => LAYER_ORDER[a] - LAYER_ORDER[b],
);

/*
 * Note what the layer containers are now *for*.
 *
 * They stay, and they hold the ground — which genuinely is a stack with a fixed order: base fills
 * under accents under edging. Everything that stands up goes into `this.standing` instead, one
 * container above them all, in the order `buildStack` sorted it. That order is a property of where
 * things stand rather than of what kind of thing they are, and no fixed set of containers can
 * express it: a fence is sometimes in front of a shrub and sometimes behind one.
 */

export { SceneRenderer } from './compositor';

/** Retained temporarily for isolated baseline profiling during the v2 rollout. */
export class LegacySceneRenderer {
  private app: Application | null = null;
  private world = new Container();
  private layers = new Map<VisualLayer, Container>();
  private textures = new Map<string, Texture>();
  private surfaceTextures = new Map<PatternCanvas, Texture>();
  private usedSurfaces = new Set<PatternCanvas>();
  private standing = new Container();
  /**
   * One raster per standing thing that is not a plant, keyed on everything that changes its pixels.
   *
   * There are tens of these a scene — a house, a shed, a pergola, four fence runs, a retaining wall
   * — against a few thousand plants, and the split is what keeps this file a compositor. The plants
   * are batched WebGL sprites because that is the load Pixi is here for; everything else is painted
   * by the composer, once, and reused until the zoom bucket or the light moves. Writing a second
   * WebGL implementation of a shed to save tens of draws would buy nothing and cost a second set of
   * drawing rules to drift from the first.
   */
  private nodeRasters = new Map<string, { canvas: PatternCanvas; origin: Point; pxPerMetre: number }>();
  private usedNodes = new Set<string>();
  /**
   * The plot's edge, created once and redrawn.
   *
   * Deliberately a field rather than a local. A fresh `Graphics` per render is added to `world`
   * and assigned to `world.mask`, which quietly leaves the *previous* one behind as an ordinary
   * child — and a mask is an opaque filled polygon, so from the second render onwards the garden
   * is covered by a white rectangle the size of the plot. It looked exactly like the surfaces had
   * failed to draw.
   */
  private mask = new Graphics();

  async mount(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    const app = new Application();
    await app.init({
      canvas,
      width,
      height,
      antialias: true,
      backgroundColor: '#f8fafc',
      /*
       * Capped rather than taken from the display. A garden of a few thousand sprites at 3× on a
       * high-density laptop is a lot of fill for no visible gain, and the raster cache is already
       * quantising its own pixel ratio the same way.
       */
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: 'webgl',
    });

    app.stage.addChild(this.world);
    this.world.addChild(this.mask);
    this.world.mask = this.mask;
    for (const layer of LAYERS) {
      const container = new Container();
      this.layers.set(layer, container);
      this.world.addChild(container);
    }
    this.world.addChild(this.standing);

    this.app = app;
  }

  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
    for (const texture of this.surfaceTextures.values()) texture.destroy(true);
    this.surfaceTextures.clear();
    this.layers.clear();

    /*
     * `removeView: false`, and this is not a detail.
     *
     * Pixi's default is to remove the canvas from the DOM on destroy, but the canvas is a React
     * element and React owns it. In development React deliberately mounts, cleans up and mounts
     * again to surface exactly this class of bug — and with the default the second mount inits
     * onto an element that has been torn out of the tree. It comes up at zero size, fails to
     * compile its shaders and reports a lost context, which reads as "this browser has no WebGL"
     * when the truth is that we removed our own canvas.
     */
    this.app?.destroy({ removeView: false }, { children: true });
    this.app = null;
  }

  /**
   * Draw a scene.
   *
   * Rebuilds the display list rather than diffing it. A scene is a few hundred surfaces and a few
   * thousand sprites; rebuilding is well under a frame, and the alternative is a reconciler whose
   * bugs would be invisible until a plant failed to move. The expensive half — rasterising the
   * surfaces — is behind the shared cache and is not repeated.
   */
  render(scene: RenderScene, view: ViewTransform, size: ViewSize): void {
    const app = this.app;
    if (!app) return;

    for (const container of this.layers.values()) {
      for (const child of container.removeChildren()) child.destroy({ children: true });
    }
    for (const child of this.standing.removeChildren()) child.destroy({ children: true });
    this.usedSurfaces.clear();
    this.usedNodes.clear();

    /*
     * The viewport in CSS pixels, taken from the caller rather than from the renderer.
     *
     * This used to be `renderer.width / renderer.resolution`, which is a guess about which of the
     * two Pixi means — and the guess only shows on a display where they differ. On a 1x screen
     * the two canvases lined up perfectly; on a 2x one the WebGL layer sat a fraction of the
     * viewport up and to the left of the overlay drawn over it, so the garden appeared twice, in
     * two halves. Both layers now measure the same element, so they cannot disagree about where
     * the middle of the view is whatever the device pixel ratio turns out to be.
     */
    const { width, height } = size;
    const toPx = (point: Point): Point => ({
      x: (point.x - view.centre.x) * view.pxPerMetre + width / 2,
      y: (point.y - view.centre.y) * view.pxPerMetre + height / 2,
    });

    this.drawGround(scene, view, toPx);
    this.drawSurfaces(scene, view, toPx);
    this.drawShadows(scene, view, toPx);
    this.drawStanding(scene, view, toPx);

    /*
     * The plot's edge. A garden plan may not draw over land it does not own, and foliage that
     * overlaps its bed by design will happily overlap the fence too — the same clamp the shadow
     * raster already applies.
     */
    this.mask.clear();
    tracePolygon(this.mask, scene.boundary, toPx);
    this.mask.fill({ color: 0xffffff });

    app.render();
    // Keep only textures used by this frame; CPU rasters remain in the bounded shared LRU.
    for (const [canvas, texture] of this.surfaceTextures) {
      if (this.usedSurfaces.has(canvas)) continue;
      texture.destroy(true);
      this.surfaceTextures.delete(canvas);
    }
    // The node rasters have no shared LRU behind them, so this map is their whole lifetime.
    for (const key of this.nodeRasters.keys()) {
      if (!this.usedNodes.has(key)) this.nodeRasters.delete(key);
    }
  }

  private drawGround(
    scene: RenderScene,
    _view: ViewTransform,
    toPx: (point: Point) => Point,
  ): void {
    const ground = new Graphics();
    tracePolygon(ground, scene.boundary, toPx);
    ground.fill({ color: PLOT_GROUND });
    this.layers.get('base')!.addChild(ground);
  }

  /**
   * The solar cast-shadow layer: one raster, composited once.
   *
   * Drawn opaque into a canvas of its own and laid down at a single opacity, for the reason
   * `SHADOW_TONE` gives — two overlapping shadows are one shadow, and only a single composite
   * gets that right. Above the ground because shadows fall *on* surfaces, below the planting
   * because a plant stands up out of the shade it is standing in.
   */
  private drawShadows(
    scene: RenderScene,
    view: ViewTransform,
    toPx: (point: Point) => Point,
  ): void {
    const { cast, occluders } = scene.shadows;
    if (!cast || occluders.length === 0) return;

    const raster = getShadowLayer(
      {
        occluders,
        cast,
        boundary: scene.boundary,
        pxPerMetre: view.pxPerMetre,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        // The composer's own rule, and it has to be the same one or the screen and the PNG
        // disagree about a plan's shadows. Soft in both views now; see `renderShadowLayer`.
        softnessMetres: PRESENTATION_SHADOW_SOFTNESS,
      },
      makeCanvas,
    );
    if (!raster) return;

    const sprite = new Sprite(this.rasterTexture(raster.canvas));
    const at = toPx(raster.originMetres);
    sprite.x = at.x;
    sprite.y = at.y;
    sprite.scale.set(view.pxPerMetre / raster.pxPerMetre);
    sprite.alpha = SHADOW_OPACITY;
    this.layers.get('surface')!.addChild(sprite);
  }

  private drawSurfaces(
    scene: RenderScene,
    view: ViewTransform,
    toPx: (point: Point) => Point,
  ): void {
    for (const item of scene.ground) {
      const surface = item.surface;
      if (!surface?.material) continue;

      const sprite = this.surfaceSprite(surface, scene, view);
      if (!sprite) continue;

      const at = toPx(sprite.originMetres);
      sprite.node.x = at.x;
      sprite.node.y = at.y;
      /* The raster was drawn at its bucket's scale, which is up to √2 off the live zoom. */
      sprite.node.scale.set(view.pxPerMetre / sprite.pxPerMetre);

      // A pergola's deck receives shadows even though its overhead beams are a structure.
      this.layers.get(item.element.fillKind === 'base' ? 'base' : 'surface')!.addChild(sprite.node);
    }

    /*
     * The edging courses, on the `surface` layer with the accents.
     *
     * Rasterised through the same shared cache as every other surface, so a brick course in
     * Visualise is the identical picture the plan view and the export draw — which is the whole
     * reason Pixi is a compositor here rather than a second painter.
     */
    for (const surface of scene.edging) {
      if (!surface.material) continue;

      const sprite = this.surfaceSprite(surface, scene, view);
      if (!sprite) continue;

      const at = toPx(sprite.originMetres);
      sprite.node.x = at.x;
      sprite.node.y = at.y;
      sprite.node.scale.set(view.pxPerMetre / sprite.pxPerMetre);

      this.layers.get('surface')!.addChild(sprite.node);
    }
  }

  private surfaceSprite(
    surface: RenderSurface,
    scene: RenderScene,
    view: ViewTransform,
  ): { node: Sprite; originMetres: Point; pxPerMetre: number } | null {
    const raster = getSurfacePattern(
      {
        elementId: surface.elementId,
        material: surface.material!,
        outline: surface.outline,
        origin: surface.anchor.origin,
        rotation: surface.anchor.rotation,
        pxPerMetre: view.pxPerMetre,
        light: scene.light,
        assets: getAssetVariants,
        exclusions: surface.exclusions ?? undefined,
        centreline: surface.centreline ?? undefined,
        element: surface.element,
        layers: surface.layers,
        assetVersion: assetVersion(),
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      },
      makeCanvas,
    );
    if (!raster) return null;

    /*
     * Keyed on the raster's identity, not the surface's: two zoom buckets of one surface are two
     * textures, and a texture whose canvas has been redrawn underneath it would show the wrong
     * pixels. `Texture.from` on the same canvas returns the same texture, so this map only has to
     * stop us re-uploading.
     */
    const texture = this.rasterTexture(raster.canvas);

    return {
      node: new Sprite(texture),
      originMetres: raster.originMetres,
      pxPerMetre: raster.pxPerMetre,
    };
  }

  /**
   * Everything that stands up, in the order `buildStack` put it in.
   *
   * ## The split, and why it is where it is
   *
   * Plants are **batched WebGL sprites**: a mature garden is a few thousand of them, every plant of
   * one species shares a texture, and that is the entire reason there is a WebGL backend at all.
   * Everything else — the house, a shed, a pergola, four fence runs — is **a raster the composer
   * painted**, uploaded once and reused. There are tens of those, so batching them would buy
   * nothing, and drawing them in WebGL instead would mean a second implementation of what a shed
   * looks like. One painter, two ways of getting its output onto the screen.
   *
   * Both go into one container in stack order, so a plant genuinely can be drawn in front of a
   * fence and a canopy across a roof. Pixi still batches the runs of same-texture plants inside
   * that order, which is most of it.
   *
   * ## The contact shadows
   *
   * Flattened into one container drawn once, because two overlapping shadows are one shadow and a
   * mature bed overlaps constantly. That forces them *below* the whole stack rather than each under
   * its own plant, which is the right trade: a shadow under the plant in front of it would be
   * invisible anyway, and drawing them in sequence at alpha muddies the entire bed.
   */
  private drawStanding(
    scene: RenderScene,
    view: ViewTransform,
    toPx: (point: Point) => Point,
  ): void {
    const shadowAsset = getAssetVariants(CONTACT_SHADOW_SPRITE)[0] ?? null;
    const shadowTexture = shadowAsset
      ? this.cachedTexture('fx:shadow', shadowAsset.image as unknown as HTMLCanvasElement)
      : null;

    const shadows = new Container();
    shadows.alpha = CONTACT_SHADOW_ALPHA;
    this.standing.addChild(shadows);

    for (const node of scene.stack) {
      if (node.kind !== 'plant') {
        const sprite = this.nodeSprite(node, scene, view, toPx);
        if (sprite) this.standing.addChild(sprite);
        continue;
      }

      const { plant } = node;
      const radius = (plant.spread / 2) * view.pxPerMetre;
      // Below a pixel and a half a plant is noise on the ground rather than a plant.
      if (radius * 2 < 1.4) continue;

      const at = toPx(plant.at);
      const texture = this.plantTexture(plant);
      if (!texture) continue;

      if (shadowTexture) {
        const shadow = new Sprite(shadowTexture);
        const reach = radius * CONTACT_SHADOW_SCALE;
        shadow.anchor.set(0.5);
        shadow.width = reach * 2;
        shadow.height = reach * 2;
        shadow.x = at.x - scene.light.x * radius * CONTACT_SHADOW_OFFSET_RATIO;
        shadow.y = at.y - scene.light.y * radius * CONTACT_SHADOW_OFFSET_RATIO;
        // Full alpha here; the container carries the opacity, so overlaps cannot compound.
        shadows.addChild(shadow);
      }

      const sprite = new Sprite(texture);
      /*
       * The elevated path and the interim, resolved by the same function the composer calls.
       *
       * `elevatedPlacement` answers `null` for a plan-camera family, so this is one branch rather
       * than a flag — and because both backends ask the same question of the same manifest, they
       * cannot come to different answers about where a plant stands. That matters more here than
       * anywhere else in this file: Pixi cannot be pixel-tested, so agreement has to be structural.
       */
      const placement = elevatedPlacement(plant.assetId, plant.at, {
        width: plant.spread,
        depth: plant.spread,
      });

      if (placement) {
        /*
         * Pixi turns a sprite about its own anchor, and the anchor is a fraction of the image — so
         * the fraction of the frame the plant stands at *is* the anchor, and placing it is setting
         * the sprite's position to the ground point. No pivot arithmetic, and the foot holds still
         * at any rotation by construction.
         */
        sprite.anchor.set(
          (plant.at.x - placement.x) / placement.width,
          (plant.at.y - placement.y) / placement.height,
        );
        sprite.width = placement.width * view.pxPerMetre;
        sprite.height = placement.height * view.pxPerMetre;
        sprite.x = at.x;
        sprite.y = at.y;
        sprite.rotation = plant.rotation;
      } else {
        sprite.anchor.set(0.5);
        sprite.width = radius * 2;
        sprite.height = radius * 2;
        sprite.x = at.x;
        /* Lifted off the shadow it stands on: the gap between the two is the plant's height, and
         * it is the same half-height the composer uses, from the same `plant.height`. */
        sprite.y = at.y - (plant.height / 2) * RISE * view.pxPerMetre;
        sprite.rotation = plant.rotation;
      }

      this.standing.addChild(sprite);
    }

    if (shadows.children.length > 0) shadows.cacheAsTexture(true);
  }

  /**
   * One non-plant node, painted by the composer into a raster of its own and uploaded.
   *
   * Cached on everything that changes its pixels: which node it is, the zoom **bucket** rather than
   * the live zoom, the light, and the asset version. Bucketing matters for the same reason it does
   * for the surface cache — the viewport eases zoom through `requestAnimationFrame`, so a key on
   * raw scale would repaint the house on every frame of every wheel gesture. Panning changes none
   * of these, so a pan costs no repaints at all.
   */
  private nodeSprite(
    node: RenderNode,
    scene: RenderScene,
    view: ViewTransform,
    toPx: (point: Point) => Point,
  ): Sprite | null {
    const { bounds } = node;
    if (bounds.width <= 0 || bounds.length <= 0) return null;

    /* √2 buckets, as `pattern-cache.ts` uses: at most 41% off the live zoom, and a redraw only
     * when the zoom crosses a bucket edge. */
    const bucket = Math.pow(2, Math.round(Math.log2(Math.max(1, view.pxPerMetre)) * 2) / 2);
    const key = `${node.id}:${bucket}:${scene.light.x.toFixed(3)},${scene.light.y.toFixed(3)}:${assetVersion()}`;
    this.usedNodes.add(key);

    let raster = this.nodeRasters.get(key);

    if (!raster) {
      const widthPx = Math.ceil(bounds.width * bucket);
      const heightPx = Math.ceil(bounds.length * bucket);
      // A node bigger than this is a plot-sized thing at a huge zoom; the shadow raster caps the
      // same way and for the same reason.
      if (widthPx < 1 || heightPx < 1 || widthPx > 4096 || heightPx > 4096) return null;

      const canvas = makeCanvas(widthPx, heightPx);
      const context = canvas.getContext('2d') as unknown as PlanContext | null;
      if (!context) return null;

      const origin: Point = { x: bounds.minX, y: bounds.minY };
      const localPx = (point: Point): Point => ({
        x: (point.x - origin.x) * bucket,
        y: (point.y - origin.y) * bucket,
      });

      const pass: PlanPass = {
        pxPerMetre: bucket,
        light: scene.light,
        assets: getAssetVariants,
        makeCanvas,
      };

      drawStackNode(context, node, scene, pass, scene.light, localPx, origin, null);

      raster = { canvas, origin, pxPerMetre: bucket };
      this.nodeRasters.set(key, raster);
    }

    const sprite = new Sprite(this.rasterTexture(raster.canvas));
    const at = toPx(raster.origin);
    sprite.x = at.x;
    sprite.y = at.y;
    sprite.scale.set(view.pxPerMetre / raster.pxPerMetre);
    return sprite;
  }

  private plantTexture(plant: RenderPlant): Texture | null {
    if (!plant.assetId) return null;

    const variants = getAssetVariants(plant.assetId);
    const asset =
      variants.find((candidate) => candidate.entry.variant === plant.variant) ?? variants[0];
    if (!asset) return null;

    return this.cachedTexture(
      `${plant.assetId}:${asset.entry.variant}`,
      asset.image as unknown as HTMLCanvasElement,
    );
  }

  private cachedTexture(key: string, source: HTMLCanvasElement): Texture {
    let texture = this.textures.get(key);
    if (!texture) {
      // Each renderer owns its GPU textures. The editor and Visualise share CPU images,
      // but retiring a texture in one view must never destroy the other view's texture.
      texture = Texture.from(source, true);
      this.textures.set(key, texture);
    }
    return texture;
  }

  private rasterTexture(canvas: PatternCanvas): Texture {
    this.usedSurfaces.add(canvas);
    let texture = this.surfaceTextures.get(canvas);
    if (!texture) {
      texture = Texture.from(canvas as unknown as HTMLCanvasElement, true);
      this.surfaceTextures.set(canvas, texture);
    }
    return texture;
  }
}

function tracePolygon(graphics: Graphics, ring: Point[], toPx: (point: Point) => Point): void {
  if (ring.length < 3) return;
  const first = toPx(ring[0]!);
  graphics.moveTo(first.x, first.y);
  for (let i = 1; i < ring.length; i += 1) {
    const at = toPx(ring[i]!);
    graphics.lineTo(at.x, at.y);
  }
  graphics.closePath();
}
