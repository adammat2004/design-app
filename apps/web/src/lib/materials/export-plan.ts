import {
  boundingBox,
  describeElement,
  elementAnchor,
  lightDirection,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import type { Unit } from '../units';
import type { Maturity, SceneView } from '../render/scene';
import type { RendererVersion } from '../render/primitives';
import { getAssetVariants } from './assets/registry';
import { drawPlan, type PlanContext, type PlanScene } from './render-plan';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';

/**
 * The plan as a picture the user can keep.
 *
 * Browser-side glue round `drawPlan`: allocates the canvas, draws the plan through the same
 * composer the concept cards and the judging sheet use, writes the feature chips on top — the
 * on-screen labels are DOM, not Konva, so a stage snapshot would lose every one of them — and
 * hands back a PNG. Nothing here decides geometry; a PNG of the plan is the plan, at a scale.
 */

/** How wide the exported plot is, in pixels. Wide enough to print A3 at a readable resolution. */
const EXPORT_WIDTH_PX = 2400;
const MARGIN_METRES = 1;
const PAPER = '#f4f2ed';

/**
 * How far above the delivered size the plan is drawn before being resampled down.
 *
 * Everything in this renderer has a size floor — `lod.ts` stops drawing a slab under three pixels
 * and a scatter unit under one and a half — so detail does not fade out gracefully at small
 * scales, it stops. Drawing at twice the width puts every one of those floors twice as far away,
 * so the units keep being drawn, and then the downsample averages them into the pixels they
 * should have occupied. That is a genuinely different picture from drawing at the final size: it
 * is the difference between a bed of plants too small to draw and a bed of plants.
 *
 * Two, not four. The cost is the square: a 2400 px plan at 2x is a 4800 px canvas, about 92 MB of
 * RGBA, which a browser will allocate. At 4x it is 368 MB and Safari refuses the canvas outright
 * — and the visible gain over 2x is very small, because the remaining detail is below the floors
 * again.
 */
const SUPERSAMPLE = 2;

/*
 * **There is no finishing pass here any more, and that is a deletion rather than a move.**
 *
 * There used to be one: a contrast and saturation lift, plan view only, on the delivered canvas —
 * written to put back the separation that compositing dozens of independently tinted photographs
 * averages away. It was a look somebody chose, and it pulled two of the measured scene grade's
 * terms in the opposite direction, which is why it had to be switched off for Visualise and left on
 * for the plan. Two finishing passes disagreeing about one picture is not a policy.
 *
 * `drawPlan` grades both views now, from the one set of constants in `grade.ts` that were solved
 * against the reference rather than dialled. A downloaded plan is therefore no longer
 * byte-identical to one downloaded before this work — deliberately, and it is the judging sheets
 * rather than this file that the change was looked at on.
 */

const makeBrowserCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

export interface ExportOptions {
  unit: Unit;
  /** Feature chips on or off — the editor's own labels toggle. */
  labels: boolean;
  /**
   * Which view to draw. Defaults to the plan, which is what the 2D tab and the review screen want.
   *
   * Visualise exports what Visualise shows: instanced planting at the chosen maturity, and a roof
   * on the house. A download that did not match the view it was taken from would be the same
   * class of contradiction as step 4 disagreeing with step 5.
   */
  view?: SceneView;
  maturity?: Maturity;
  /** The editor's own shadows toggle, for the reason `labels` and `maturity` are here. */
  shadows?: boolean;
  rendererVersion?: RendererVersion;
}

/** Draws the scene into a fresh canvas and resolves to its PNG. */
export async function exportPlanPng(scene: PlanScene, options: ExportOptions): Promise<Blob> {
  const box = boundingBox(scene.boundary);
  const width = Math.ceil(EXPORT_WIDTH_PX);
  const height = Math.ceil(
    ((box.length + MARGIN_METRES * 2) / (box.width + MARGIN_METRES * 2)) * width,
  );

  /* Drawn large, delivered small. See `SUPERSAMPLE`. */
  const pxPerMetre = (width * SUPERSAMPLE) / (box.width + MARGIN_METRES * 2);
  const bigWidth = width * SUPERSAMPLE;
  const bigHeight = height * SUPERSAMPLE;

  const big = document.createElement('canvas');
  big.width = bigWidth;
  big.height = bigHeight;
  const context = big.getContext('2d');
  if (!context) throw new Error('The browser gave no 2D context to draw the plan into.');

  context.fillStyle = PAPER;
  context.fillRect(0, 0, bigWidth, bigHeight);

  const rasterOrigin = { x: box.minX - MARGIN_METRES, y: box.minY - MARGIN_METRES };

  drawPlan(
    context as unknown as PlanContext,
    scene,
    {
      pxPerMetre,
      light: lightDirection(scene.site) ?? undefined,
      makeCanvas: makeBrowserCanvas,
      assets: getAssetVariants,
    },
    rasterOrigin,
    { view: options.view ?? 'plan', ...(options.rendererVersion ? { rendererVersion: options.rendererVersion } : {}),
      ...(options.maturity ? { maturity: options.maturity } : {}),
      ...(options.shadows === undefined ? {} : { shadows: options.shadows }) },
  );

  if (options.labels) {
    drawLabels(context, scene.elements, options.unit, pxPerMetre, rasterOrigin);
  }

  /*
   * The downsample. One `drawImage` with smoothing on, which is the browser's own resampler and
   * is both better and far faster than anything worth writing here.
   */
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const out = canvas.getContext('2d');
  if (!out) throw new Error('The browser gave no 2D context to resample the plan into.');

  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = 'high';
  out.drawImage(big, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    );
  });
}

/**
 * The feature chips, drawn the way `ConceptLabels` lays them out on screen: name, then size, on
 * a white pill at the element's anchor. Furniture gets none, for the reason it gets none there.
 * No collision pass — at export scale the chips are small relative to the plan and a stacked
 * label with a leader would need the DOM layout the screen does; this is the honest 90%.
 */
function drawLabels(
  context: CanvasRenderingContext2D,
  elements: DesignElement[],
  unit: Unit,
  pxPerMetre: number,
  rasterOrigin: Point,
): void {
  const scale = pxPerMetre / 32;
  const fontPx = Math.max(11, Math.round(11 * scale));
  const smallPx = Math.max(9, Math.round(9.5 * scale));
  const padX = 8 * scale;
  const padY = 5 * scale;
  const radius = 6 * scale;

  for (const element of elements) {
    if (element.hidden || element.role !== 'feature' || !element.name) continue;
    if (element.category === 'furniture') continue;

    const anchor = elementAnchor(element);
    const x = (anchor.x - rasterOrigin.x) * pxPerMetre;
    const y = (anchor.y - rasterOrigin.y) * pxPerMetre;
    const size = describeElement(element, unit);

    context.font = `600 ${fontPx}px system-ui, sans-serif`;
    const nameWidth = context.measureText(element.name).width;
    context.font = `${smallPx}px system-ui, sans-serif`;
    const sizeWidth = size ? context.measureText(size).width : 0;

    const width = Math.max(nameWidth, sizeWidth) + padX * 2;
    const height = fontPx + (size ? smallPx + 2 * scale : 0) + padY * 2;
    const left = x - width / 2;
    const top = y - height / 2;

    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.strokeStyle = 'rgba(51, 65, 58, 0.25)';
    context.lineWidth = Math.max(1, scale);
    roundedRect(context, left, top, width, height, radius);
    context.fill();
    context.stroke();

    context.fillStyle = '#1b4332';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.font = `600 ${fontPx}px system-ui, sans-serif`;
    context.fillText(element.name, x, top + padY);

    if (size) {
      context.fillStyle = '#5b6560';
      context.font = `${smallPx}px system-ui, sans-serif`;
      context.fillText(size, x, top + padY + fontPx + 2 * scale);
    }
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/** A file name the browser will accept, from the project's name. */
export function planFileName(projectName: string): string {
  const stem = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'garden-plan'}.png`;
}

/** Exports and hands the PNG to the browser as a download. */
export async function downloadPlanPng(
  scene: PlanScene,
  options: ExportOptions & { fileName: string },
): Promise<void> {
  const blob = await exportPlanPng(scene, options);
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = options.fileName;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // The click has consumed the URL by the time this runs; revoking sooner cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
