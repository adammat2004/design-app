/** Bounded measurements live outside the deterministic, serializable presentation scene. */
export interface RenderFrameMetrics {
  renderer: 'pixi' | 'canvas';
  version: string;
  revision: string;
  frameMs: number;
  compileMs: number;
  surfacesRasterized: number;
  shadowsRasterized: number;
  nodesRasterized: number;
  surfaceRasterMs: number;
  shadowRasterMs: number;
  nodeRasterMs: number;
  spriteCount: number;
  culled: number;
  textureBytes: number;
  cacheHits: number;
  cacheMisses: number;
}
const timings = new WeakMap<object, number>();
export function recordCompilation(scene: object, milliseconds: number): void { timings.set(scene, milliseconds); }
export function compilationTime(scene: object): number { return timings.get(scene) ?? 0; }
export function clockNow(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

export function publishFrame(canvas: HTMLCanvasElement, metrics: RenderFrameMetrics): void {
  canvas.dataset.renderMetrics = JSON.stringify(metrics);
  canvas.dataset.renderer = metrics.version;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('renderDiagnostics')) {
    const target = window as unknown as { gardenRenderDiagnostics?: RenderFrameMetrics[] };
    const samples = target.gardenRenderDiagnostics ??= [];
    samples.push(metrics);
    if (samples.length > 240) samples.shift();
  }
}

/** An explicit temporary browser fallback; it is never written into the design. */
export function browserRendererVersion(): 'legacy' | 'v2' {
  const override = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('renderer') : null;
  if (override === 'legacy' || override === 'v2') return override;
  // Production stays gated until the visual/asset review is signed off. Development previews v2.
  const configured = process.env.NEXT_PUBLIC_GARDEN_RENDERER;
  if (configured === 'legacy' || configured === 'v2') return configured;
  return process.env.NODE_ENV === 'development' ? 'v2' : 'legacy';
}
