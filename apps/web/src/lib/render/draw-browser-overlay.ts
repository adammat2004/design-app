import type { SiteSection } from '@garden-studio/schema';
import { getAssetVariants } from '../materials/assets/registry';
import { drawOverlay, type PlanContext } from '../materials/render-plan';
import type { MakeCanvas, PatternCanvas } from '../materials/render-surface-pattern';
import type { RenderScene } from './scene';
import type { ViewSize, ViewTransform } from './pixi/renderer';

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

/** Shared object pass for the editable canvas and the presentation view. */
export function drawBrowserOverlay(canvas: HTMLCanvasElement | null, scene: RenderScene,
  site: SiteSection, view: ViewTransform, { width, height }: ViewSize): void {
  if (!canvas) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawOverlay(context as unknown as PlanContext, scene, site,
    { pxPerMetre: view.pxPerMetre, light: scene.light, assets: getAssetVariants, makeCanvas },
    { x: view.centre.x - width / 2 / view.pxPerMetre,
      y: view.centre.y - height / 2 / view.pxPerMetre });
}
