import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Point } from '@garden-studio/schema';
import { getAssetVariants } from '../../materials/assets/registry';
import { CONTACT_SHADOW_SPRITE } from '../../materials/assets/material-assets';
import { getSurfacePattern } from '../../materials/pattern-cache';
import { getShadowLayer } from '../../materials/shadow-cache';
import type { MakeCanvas, PatternCanvas } from '../../materials/render-surface-pattern';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  SHADOW_OPACITY,
} from '../../materials/light';
import { PLOT_GROUND } from '../../materials/render-plan';
import type { RenderPlant, RenderScene, RenderSurface, VisualLayer } from '../scene';
import { LAYER_ORDER } from '../visual-layer';

/**
 * The WebGL backend, for Visualise.
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
 * ## Why it cannot be pixel-tested
 *
 * Pixi v8 has no supported Node backend, so nothing here runs under Vitest. That is precisely why
 * `buildRenderScene` is a pure function tested on its own: every decision about *what* to draw is
 * asserted before a renderer sees it, and this file is left with nothing to be wrong about except
 * paint. The Canvas2D backend stays the reference for the judging sheets.
 */

/** Where the camera is: metres per screen, and which world point is in the middle. */
export interface ViewTransform {
  pxPerMetre: number;
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

export class SceneRenderer {
  private app: Application | null = null;
  private world = new Container();
  private layers = new Map<VisualLayer, Container>();
  private textures = new Map<string, Texture>();
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
      backgroundColor: PLOT_GROUND,
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

    this.app = app;
  }

  resize(width: number, height: number): void {
    this.app?.renderer.resize(width, height);
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
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

    for (const container of this.layers.values()) container.removeChildren();

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
    this.drawPlants(scene, view, toPx);

    /*
     * The plot's edge. A garden plan may not draw over land it does not own, and foliage that
     * overlaps its bed by design will happily overlap the fence too — the same clamp the shadow
     * raster already applies.
     */
    this.mask.clear();
    tracePolygon(this.mask, scene.boundary, toPx);
    this.mask.fill({ color: 0xffffff });

    app.render();
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
      },
      makeCanvas,
    );
    if (!raster) return;

    const sprite = new Sprite(Texture.from(raster.canvas as unknown as HTMLCanvasElement));
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
    for (const item of [...scene.ground, ...scene.objects]) {
      const surface = item.surface;
      if (!surface?.material) continue;

      const sprite = this.surfaceSprite(surface, scene, view);
      if (!sprite) continue;

      const at = toPx(sprite.originMetres);
      sprite.node.x = at.x;
      sprite.node.y = at.y;
      /* The raster was drawn at its bucket's scale, which is up to √2 off the live zoom. */
      sprite.node.scale.set(view.pxPerMetre / sprite.pxPerMetre);

      this.layers.get(item.visualLayer)!.addChild(sprite.node);
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
    const key = `${surface.elementId}:${raster.pxPerMetre}:${raster.widthPx}x${raster.heightPx}`;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = Texture.from(raster.canvas as unknown as HTMLCanvasElement);
      this.textures.set(key, texture);
    } else {
      texture.source.update();
    }

    return {
      node: new Sprite(texture),
      originMetres: raster.originMetres,
      pxPerMetre: raster.pxPerMetre,
    };
  }

  /**
   * The planting: one batched sprite per plant, plus its contact shadow.
   *
   * This is the load Pixi is here for. Every plant of one species shares a texture, so the whole
   * bed collapses into a few draw calls no matter how many plants are in it — which is what makes
   * a mature garden pannable rather than a slideshow.
   */
  private drawPlants(scene: RenderScene, view: ViewTransform, toPx: (point: Point) => Point): void {
    const shadowAsset = getAssetVariants(CONTACT_SHADOW_SPRITE)[0] ?? null;
    const shadowTexture = shadowAsset
      ? this.cachedTexture('fx:shadow', shadowAsset.image as unknown as HTMLCanvasElement)
      : null;

    /*
     * Every plant's contact shadow into one container, flattened, and laid down once.
     *
     * Two overlapping shadows are one shadow — a shrub standing against a hedge is not twice as
     * dark — and in a mature bed at 93% coverage every shadow overlaps several others, so drawing
     * them in sequence at alpha muddies the whole bed. `cacheAsTexture` renders the container to a
     * texture and draws that once, so the container's own alpha applies to the flattened result.
     * The same rule the cast-shadow layer has always followed and has a test for, applied to the
     * presentation convention rather than to the solar claim.
     */
    const shadows = new Container();
    shadows.alpha = CONTACT_SHADOW_ALPHA;
    this.layers.get('groundcover')!.addChild(shadows);

    for (const plant of scene.plants) {
      const radius = (plant.spread / 2) * view.pxPerMetre;
      // Below a pixel and a half a plant is noise on the ground rather than a plant.
      if (radius * 2 < 1.4) continue;

      const at = toPx(plant.at);
      const container = this.layers.get(plant.visualLayer)!;

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
      sprite.anchor.set(0.5);
      sprite.width = radius * 2;
      sprite.height = radius * 2;
      sprite.x = at.x;
      sprite.y = at.y;
      sprite.rotation = plant.rotation;
      container.addChild(sprite);
    }

    if (shadows.children.length > 0) shadows.cacheAsTexture(true);
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
      texture = Texture.from(source);
      this.textures.set(key, texture);
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
