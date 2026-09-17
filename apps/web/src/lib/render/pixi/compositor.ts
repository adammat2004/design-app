import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Point } from '@garden-studio/schema';
import { assetVersion, getAssetVariants } from '../../materials/assets/registry';
import { getSurfacePattern, bucketScale, zoomBucket, patternCacheStats } from '../../materials/pattern-cache';
import { getShadowLayer, shadowCacheStats } from '../../materials/shadow-cache';
import { PRESENTATION_SHADOW_SOFTNESS } from '../../materials/render-shadow-layer';
import { SHADOW_OPACITY, NIGHT_MAX_ALPHA } from '../../materials/light';
import { drawPrimitive, drawContactPass, drawScene, type PlanContext, type PlanPass } from '../../materials/render-plan';
import type { MakeCanvas, PatternCanvas } from '../../materials/render-surface-pattern';
import { RasterLru } from '../../materials/raster-lru';
import { elevatedPlacement } from '../../materials/symbols/elevated';
import { RISE } from '../camera';
import type { RenderScene, RenderPlant } from '../scene';
import { intersects, RENDER_PASSES, type RenderPrimitive, type WorldBounds, type RenderPassName } from '../primitives';
import { fingerprint } from '../fingerprint';
import { plantMassOpacity, clusterMassOpacity, plantingLodScale, type PlantCluster } from '../plant-clusters';
import { clockNow, compilationTime, publishFrame } from '../diagnostics';
import type { ViewSize, ViewTransform } from './renderer';

interface Raster { canvas: PatternCanvas; origin: Point; pxPerMetre: number }
const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

/** Shared painters, ordered GPU vegetation, and a retained world-space display list. */
export class SceneRenderer {
  private app: Application | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private root = new Container();
  private world = new Container();
  private access = new Container();
  private mask = new Graphics();
  private layers = new Map<RenderPassName, Container>();
  private textures = new Map<string, Texture>();
  private rasterTextures = new Map<PatternCanvas, Texture>();
  private usedRasters = new Set<PatternCanvas>();
  private usedAssets = new Set<string>();
  private rasters = new RasterLru<Raster>(256, { maxBytes: 96 * 1024 * 1024,
    sizeOf: (raster) => raster.canvas.width * raster.canvas.height * 4 });
  private displayBounds: { container: Container; bounds: WorldBounds }[] = [];
  private lastKey = '';
  private coverage: WorldBounds | null = null;
  private fades: { sprite: Sprite; plantId?: string; cluster?: PlantCluster }[] = [];
  private rasterTime = { surfaceRasterMs: 0, shadowRasterMs: 0, nodeRasterMs: 0 };

  async mount(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    const app = new Application();
    await app.init({ canvas, width, height, antialias: true, backgroundColor: '#f8fafc',
      resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true,
      preference: 'webgl', autoStart: false });
    app.stage.addChild(this.root);
    this.root.addChild(this.world, this.access);
    this.world.addChild(this.mask);
    this.world.mask = this.mask;
    for (const name of RENDER_PASSES) {
      const layer = name === 'access' ? this.access : new Container();
      this.layers.set(name, layer);
      if (name !== 'access') this.world.addChild(layer);
    }
    this.canvas = canvas;
    this.app = app;
  }

  resize(width: number, height: number): void {
    if (this.app && (this.app.screen.width !== width || this.app.screen.height !== height)) this.app.renderer.resize(width, height);
  }

  destroy(): void {
    this.app?.destroy({ removeView: false }, { children: true });
    this.app = null;
    for (const texture of this.textures.values()) texture.destroy(true);
    for (const texture of this.rasterTextures.values()) texture.destroy(true);
    this.textures.clear(); this.rasterTextures.clear(); this.rasters.clear();
    this.usedRasters.clear(); this.usedAssets.clear(); this.displayBounds = [];
    this.layers.clear(); this.canvas = null; this.coverage = null;
  }

  render(scene: RenderScene, view: ViewTransform, size: ViewSize): void {
    if (!this.app || !this.canvas || view.pxPerMetre <= 0) return;
    const started = clockNow();
    this.rasterTime = { surfaceRasterMs: 0, shadowRasterMs: 0, nodeRasterMs: 0 };
    const patternBefore = patternCacheStats(), shadowBefore = shadowCacheStats(), rasterBefore = this.rasters.stats;
    const viewport = { minX: view.centre.x - size.width / view.pxPerMetre / 2,
      minY: view.centre.y - size.height / view.pxPerMetre / 2,
      width: size.width / view.pxPerMetre, length: size.height / view.pxPerMetre };
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const scale = bucketScale(zoomBucket(view.pxPerMetre));
    const key = `${scene.rendererVersion}:${scene.revision}:${scale}:${ratio}:${assetVersion()}`;
    const contained = this.coverage && viewport.minX >= this.coverage.minX && viewport.minY >= this.coverage.minY &&
      viewport.minX + viewport.width <= this.coverage.minX + this.coverage.width &&
      viewport.minY + viewport.length <= this.coverage.minY + this.coverage.length;
    if (key !== this.lastKey || !contained) {
      this.coverage = { minX: viewport.minX - viewport.width / 2, minY: viewport.minY - viewport.length / 2,
        width: viewport.width * 2, length: viewport.length * 2 };
      this.rebuild(scene, scale, ratio);
      this.lastKey = key;
    }
    this.root.scale.set(view.pxPerMetre);
    this.root.position.set(size.width / 2 - view.centre.x * view.pxPerMetre,
      size.height / 2 - view.centre.y * view.pxPerMetre);
    let culled = 0;
    for (const entry of this.displayBounds) {
      entry.container.visible = intersects(entry.bounds, viewport);
      if (!entry.container.visible) culled++;
    }
    const plantingScale = plantingLodScale(view.pxPerMetre, view.plantingPreview);
    for (const entry of this.fades) entry.sprite.alpha = entry.cluster
      ? clusterMassOpacity(entry.cluster, plantingScale)
      : 1 - plantMassOpacity(scene.clusters, entry.plantId!, plantingScale);
    this.app.render();
    const patternAfter = patternCacheStats(), shadowAfter = shadowCacheStats(), rasterAfter = this.rasters.stats;
    publishFrame(this.canvas, { renderer: 'pixi', version: scene.rendererVersion, revision: scene.revision,
      frameMs: clockNow() - started, compileMs: compilationTime(scene),
      surfacesRasterized: patternAfter.misses - patternBefore.misses,
      shadowsRasterized: shadowAfter.misses - shadowBefore.misses,
      nodesRasterized: rasterAfter.misses - rasterBefore.misses,
      ...this.rasterTime,
      spriteCount: this.displayBounds.length, culled, textureBytes: this.textureBytes(),
      cacheHits: patternAfter.hits - patternBefore.hits + shadowAfter.hits - shadowBefore.hits + rasterAfter.hits - rasterBefore.hits,
      cacheMisses: patternAfter.misses - patternBefore.misses + shadowAfter.misses - shadowBefore.misses + rasterAfter.misses - rasterBefore.misses });
  }

  private rebuild(scene: RenderScene, scale: number, ratio: number): void {
    for (const layer of this.layers.values()) for (const child of layer.removeChildren()) child.destroy({ children: true });
    this.usedRasters.clear(); this.usedAssets.clear(); this.displayBounds = []; this.fades = [];
    this.mask.clear();
    this.mask.poly(scene.boundary.flatMap((point) => [point.x, point.y])).fill({ color: 0xffffff });
    const pass: PlanPass = { pxPerMetre: scale * ratio, lodPxPerMetre: scale, light: scene.light,
      assets: getAssetVariants, makeCanvas, grade: false, massOpacity: 1, plantOpacity: 1 };
    if (scene.rendererVersion === 'legacy') {
      const access = scene.passes.access.find((primitive) => primitive.kind === 'access');
      if (access?.kind === 'access') {
        const raster = this.raster(`legacy:${scene.revision}`, scene.bounds, scale, ratio,
          (context, rasterPass, origin) => drawScene(context, scene, access.site, rasterPass, origin), pass);
        if (raster) this.addRaster(raster, 'terrain', scene.bounds);
      }
    } else {
      for (const name of RENDER_PASSES) {
        if (name === 'cast-shadows') { this.castShadows(scene, scale, ratio); continue; }
        if (name === 'contacts') {
          const key = fingerprint([scene.passes.contacts.filter((p) => p.kind === 'contact-shadow').map((primitive) => primitive.cacheKey), scene.boundary, scene.light]);
          const raster = this.raster(`contacts:${key}`, scene.bounds, scale, ratio,
            (context, rasterPass, origin) => drawContactPass(context, scene, rasterPass,
              (point) => ({ x: (point.x - origin.x) * rasterPass.pxPerMetre, y: (point.y - origin.y) * rasterPass.pxPerMetre })), pass);
          if (raster) this.addRaster(raster, name, scene.bounds);
        }
        for (const primitive of scene.passes[name]) {
          if (primitive.kind === 'contact-shadow') continue;
          if (primitive.clip !== 'none' && !intersects(primitive.bounds, this.coverage!)) continue;
          if (primitive.kind === 'sprite' && primitive.node.kind === 'plant') {
            const sprite = this.plantSprite(primitive.node.plant, scene);
            if (sprite) { this.add(sprite, name, primitive.bounds);
              this.fades.push({ sprite, plantId: primitive.node.id }); continue; }
          }
          if (primitive.kind === 'surface' && primitive.item.surface?.material) {
            const surface = primitive.item.surface;
            const started = clockNow();
            const misses = patternCacheStats().misses;
            const raster = getSurfacePattern({ elementId: surface.elementId, material: surface.material!,
              outline: surface.outline, origin: surface.anchor.origin, rotation: surface.anchor.rotation,
              pxPerMetre: scale, pixelRatio: ratio, light: scene.light, assets: getAssetVariants,
              exclusions: surface.exclusions ?? undefined, centreline: surface.centreline ?? undefined,
              element: surface.element, layers: surface.layers, assetVersion: assetVersion() }, makeCanvas);
            if (patternCacheStats().misses > misses) this.rasterTime.surfaceRasterMs += clockNow() - started;
            if (raster) this.addRaster({ canvas: raster.canvas, origin: raster.originMetres, pxPerMetre: raster.pxPerMetre }, name, primitive.bounds);
            continue;
          }
          const bounds = primitive.kind === 'access'
            ? { minX: scene.bounds.minX - 1, minY: scene.bounds.minY - 1, width: scene.bounds.width + 2, length: scene.bounds.length + 2 }
            : primitive.bounds;
          const raster = this.raster(`${primitive.cacheKey}:${name === 'standing' ? scene.night : ''}`, bounds, scale, ratio,
            (context, rasterPass, origin) => drawPrimitive(context, primitive, scene, rasterPass, origin), pass);
          if (raster) {
            const sprite = this.addRaster(raster, name, bounds, primitive);
            if (primitive.kind === 'plant-mass') this.fades.push({ sprite, cluster: primitive.cluster });
            if (primitive.kind === 'sprite' && primitive.node.kind === 'plant') this.fades.push({ sprite, plantId: primitive.node.id });
          }
        }
      }
    }
    for (const [canvas, texture] of this.rasterTextures) if (!this.usedRasters.has(canvas)) {
      texture.destroy(true); this.rasterTextures.delete(canvas);
    }
    for (const [key, texture] of this.textures) if (!this.usedAssets.has(key)) {
      texture.destroy(true); this.textures.delete(key);
    }
  }

  private castShadows(scene: RenderScene, scale: number, ratio: number): void {
    if (!scene.shadows.cast || !scene.passes['cast-shadows'].length) return;
    const started = clockNow();
    const misses = shadowCacheStats().misses;
    const raster = getShadowLayer({ occluders: scene.passes['cast-shadows'].flatMap((p) => p.kind === 'shadow-caster' ? [p.occluder] : []),
      cast: scene.shadows.cast, boundary: scene.boundary, pxPerMetre: scale, pixelRatio: ratio,
      // Soft is Visualise's presentation choice; a diagram draws the hard edge. Same rule as the
      // composer's `drawShadowLayer`, or the screen and the PNG disagree about a plan's shadows.
      softnessMetres: scene.view === 'visualise' ? PRESENTATION_SHADOW_SOFTNESS : 0 }, makeCanvas);
    if (shadowCacheStats().misses > misses) this.rasterTime.shadowRasterMs += clockNow() - started;
    if (!raster) return;
    const sprite = this.addRaster({ canvas: raster.canvas, origin: raster.originMetres, pxPerMetre: raster.pxPerMetre }, 'cast-shadows', scene.bounds);
    sprite.alpha = SHADOW_OPACITY;
  }

  private raster(key: string, bounds: WorldBounds, scale: number, ratio: number,
    draw: (context: PlanContext, pass: PlanPass, origin: Point) => void, pass: PlanPass): Raster | null {
    if (bounds.width <= 0 || bounds.length <= 0) return null;
    const cacheKey = `${key}:${scale}:${ratio}:${assetVersion()}`;
    const existing = this.rasters.get(cacheKey);
    if (existing) return existing;
    const started = clockNow();
    const pxPerMetre = Math.min(scale * ratio, 4094 / bounds.width, 4094 / bounds.length);
    const canvas = makeCanvas(Math.max(1, Math.ceil(bounds.width * pxPerMetre) + 2), Math.max(1, Math.ceil(bounds.length * pxPerMetre) + 2));
    const context = canvas.getContext('2d') as PlanContext | null;
    if (!context) return null;
    const origin = { x: bounds.minX - 1 / pxPerMetre, y: bounds.minY - 1 / pxPerMetre };
    draw(context, { ...pass, pxPerMetre }, origin);
    const raster = { canvas, origin, pxPerMetre };
    this.rasters.set(cacheKey, raster);
    this.rasterTime.nodeRasterMs += clockNow() - started;
    return raster;
  }

  private addRaster(raster: Raster, layer: RenderPassName, bounds: WorldBounds, primitive?: RenderPrimitive): Sprite {
    this.usedRasters.add(raster.canvas);
    let texture = this.rasterTextures.get(raster.canvas);
    if (!texture) {
      texture = Texture.from(raster.canvas as unknown as HTMLCanvasElement, true);
      this.rasterTextures.set(raster.canvas, texture);
    }
    const sprite = new Sprite(texture);
    sprite.position.set(raster.origin.x, raster.origin.y);
    sprite.scale.set(1 / raster.pxPerMetre);
    if (primitive?.kind === 'ground-light' || primitive?.kind === 'emissive') sprite.blendMode = 'add';
    this.add(sprite, layer, bounds);
    return sprite;
  }

  private add(container: Container, layer: RenderPassName, bounds: WorldBounds): void {
    this.layers.get(layer)!.addChild(container);
    this.displayBounds.push({ container, bounds });
  }

  private plantSprite(plant: RenderPlant, scene: RenderScene): Sprite | null {
    if (!plant.assetId) return null;
    const variants = getAssetVariants(plant.assetId);
    const asset = variants.find((candidate) => candidate.entry.variant === plant.variant) ?? variants[0];
    if (!asset) return null;
    const key = `${assetVersion()}:${plant.assetId}:${asset.entry.variant}`;
    this.usedAssets.add(key);
    let texture = this.textures.get(key);
    if (!texture) {
      texture = Texture.from(asset.image as HTMLImageElement, true);
      // Catalogue cutouts shrink from hundreds of pixels to tens. Linear sampling without
      // mipmaps aliases individual leaves into speckles instead of a coherent canopy.
      texture.source.autoGenerateMipmaps = true;
      texture.source.mipmapFilter = 'linear';
      this.textures.set(key, texture);
    }
    const sprite = new Sprite(texture);
    const placement = elevatedPlacement(plant.assetId, plant.at, { width: plant.spread, depth: plant.spread });
    if (placement) {
      sprite.anchor.set((plant.at.x - placement.x) / placement.width, (plant.at.y - placement.y) / placement.height);
      sprite.width = placement.width; sprite.height = placement.height;
      sprite.position.set(plant.at.x, plant.at.y);
    } else {
      sprite.anchor.set(0.5);
      const factor = plant.spread / Math.max(asset.image.width, asset.image.height);
      sprite.width = asset.image.width * factor; sprite.height = asset.image.height * factor;
      sprite.position.set(plant.at.x, plant.at.y - plant.height / 2 * RISE);
    }
    sprite.rotation = plant.rotation;
    if (scene.night) {
      const channel = Math.round(255 * (1 - scene.night * NIGHT_MAX_ALPHA * 0.8));
      sprite.tint = (channel << 16) | (channel << 8) | channel;
    }
    return sprite;
  }

  private textureBytes(): number {
    let bytes = 0;
    for (const canvas of this.rasterTextures.keys()) bytes += canvas.width * canvas.height * 4;
    for (const texture of this.textures.values()) bytes += Math.ceil(texture.width * texture.height * 4 *
      (texture.source.autoGenerateMipmaps ? 4 / 3 : 1));
    return bytes;
  }
}
