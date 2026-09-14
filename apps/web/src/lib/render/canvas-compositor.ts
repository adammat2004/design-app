import { getAssetVariants } from '../materials/assets/registry';
import { drawScene, type PlanContext } from '../materials/render-plan';
import type { PatternCanvas } from '../materials/render-surface-pattern';
import type { RenderScene } from './scene';
import type { ViewSize, ViewTransform } from './pixi/renderer';
import { plantingLodScale } from './plant-clusters';

/** Canvas fallback and browser reference use the same primitive scene as the GPU. */
export function drawCanvasScene(canvas: HTMLCanvasElement, scene: RenderScene,
  view: ViewTransform, size: ViewSize): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D is unavailable');
  const access = scene.passes.access.find((primitive) => primitive.kind === 'access');
  if (!access || access.kind !== 'access') return;
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, canvas.width, canvas.height);
  drawScene(context as unknown as PlanContext, scene, access.site,
    { pxPerMetre: view.pxPerMetre * ratio, lodPxPerMetre: plantingLodScale(view.pxPerMetre, view.plantingPreview),
      assets: getAssetVariants, grade: false,
      makeCanvas: (width, height) => {
        const scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
        return scratch as unknown as PatternCanvas;
      } },
    { x: view.centre.x - size.width / view.pxPerMetre / 2,
      y: view.centre.y - size.height / view.pxPerMetre / 2 });
  canvas.dataset.revision = scene.revision;
}
