import {
  findMaterial,
  isCounted,
  MATERIALS,
  type DesignElement,
} from '@garden-studio/schema';
import { niceStep } from '../grid';
import { materialFill } from '../material-colours';
import { elementArea } from '../concepts';
import { fromDisplay, type Unit } from '../units';

/**
 * The strip under an exported plan that makes it a drawing rather than a screenshot: what it is,
 * when it was drawn, which way is north, how big a metre is, and what the colours mean.
 *
 * The on-screen compass and scale bar are DOM chrome, so the PNG had neither — a plan with no scale
 * cannot be measured off and a plan with no north cannot be oriented in the garden, which are the
 * two things somebody does with a printed plan. Drawn below the plan rather than over it, so it
 * never covers a corner of the garden.
 *
 * The layout decisions are pure functions so they can be tested without a canvas; `drawSheetFooter`
 * only paints what they decide.
 */

/** Delivered height of the strip, in pixels at the export's final size. */
export const FOOTER_HEIGHT_PX = 150;
/** Most legend entries shown. Past a dozen a legend is a list nobody reads. */
export const LEGEND_LIMIT = 12;

export interface ScaleBar {
  /** In the display unit. */
  length: number;
  /** On the canvas. */
  px: number;
  unit: Unit;
}

/** The longest round-numbered bar that fits in `maxPx`. */
export function scaleBarFor(pxPerMetre: number, maxPx: number, unit: Unit): ScaleBar {
  const length = niceStep(pxPerMetre, unit, maxPx);
  return { length, px: fromDisplay(length, unit) * pxPerMetre, unit };
}

export interface LegendEntry {
  label: string;
  colour: string;
}

/**
 * One entry per material on the plan, the most ground first, and things counted rather than
 * measured — furniture, lights — after them.
 *
 * Keyed by material rather than by category, because a legend that says "Paved area" beside two
 * different greys explains nothing; it is the porcelain and the setts somebody needs told apart.
 */
export function legendEntries(elements: DesignElement[], limit = LEGEND_LIMIT): LegendEntry[] {
  const byMaterial = new Map<string, { label: string; colour: string; area: number; counted: boolean }>();

  for (const element of elements) {
    if (element.hidden) continue;
    const material = findMaterial(element.material) ?? MATERIALS[element.category][0];
    if (!material) continue;

    const entry = byMaterial.get(material.id) ?? {
      label: material.label,
      colour: materialFill(element),
      area: 0,
      counted: isCounted(element.category),
    };
    entry.area += elementArea(element);
    byMaterial.set(material.id, entry);
  }

  return [...byMaterial.values()]
    .sort(
      (a, b) => Number(a.counted) - Number(b.counted) || b.area - a.area || a.label.localeCompare(b.label),
    )
    .slice(0, limit)
    .map(({ label, colour }) => ({ label, colour }));
}

export interface SheetFooter {
  title: string;
  /** Already formatted, so the caller decides the locale and the test decides the date. */
  date: string;
  unit: Unit;
  pxPerMetre: number;
  /** `site.orientation`: degrees clockwise from screen-up to true north. */
  orientation: number;
  legend: LegendEntry[];
}

const INK = '#1b4332';
const MUTED = '#5b6560';
const RULE = 'rgba(51, 65, 58, 0.25)';

/**
 * Paints the strip into `[left, top, width, height]`. `scale` is how many canvas pixels stand for one
 * delivered pixel — the export draws at twice size and resamples down.
 */
export function drawSheetFooter(
  context: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
  footer: SheetFooter,
  scale: number,
): void {
  const pad = 24 * scale;
  const { left, top, width, height } = box;

  context.save();
  context.fillStyle = '#ffffff';
  context.fillRect(left, top, width, height);
  context.strokeStyle = RULE;
  context.lineWidth = Math.max(1, scale);
  context.beginPath();
  context.moveTo(left, top + context.lineWidth / 2);
  context.lineTo(left + width, top + context.lineWidth / 2);
  context.stroke();

  context.textBaseline = 'top';
  context.textAlign = 'left';

  /* Title block, left. */
  const titleWidth = Math.min(width * 0.28, 520 * scale);
  context.fillStyle = INK;
  context.font = `700 ${20 * scale}px system-ui, sans-serif`;
  context.fillText(footer.title, left + pad, top + pad, titleWidth);
  context.fillStyle = MUTED;
  context.font = `${12 * scale}px system-ui, sans-serif`;
  context.fillText(footer.date, left + pad, top + pad + 30 * scale, titleWidth);
  context.fillText(
    'Indicative plan — not for construction',
    left + pad,
    top + pad + 48 * scale,
    titleWidth,
  );

  /* North arrow and scale bar, right. */
  const northX = left + width - pad - 22 * scale;
  const northY = top + height / 2;
  drawNorthArrow(context, northX, northY, 22 * scale, footer.orientation, scale);

  const barMax = Math.min(width * 0.22, 420 * scale);
  const bar = scaleBarFor(footer.pxPerMetre, barMax, footer.unit);
  const barRight = northX - 56 * scale;
  const barLeft = barRight - bar.px;
  const barY = top + height / 2;
  drawScaleBar(context, barLeft, barY, bar, scale);

  /* Legend, between them. */
  const legendLeft = left + pad + titleWidth + pad;
  const legendRight = barLeft - pad * 1.5;
  drawLegend(
    context,
    { left: legendLeft, top: top + pad, width: legendRight - legendLeft, height: height - pad * 2 },
    footer.legend,
    scale,
  );

  context.restore();
}

function drawNorthArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  orientation: number,
  scale: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate((orientation * Math.PI) / 180);

  context.strokeStyle = INK;
  context.lineWidth = 1.5 * scale;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = INK;
  context.beginPath();
  context.moveTo(0, -radius * 0.8);
  context.lineTo(radius * 0.35, radius * 0.45);
  context.lineTo(0, radius * 0.2);
  context.lineTo(-radius * 0.35, radius * 0.45);
  context.closePath();
  context.fill();

  context.textAlign = 'center';
  context.textBaseline = 'bottom';
  context.font = `700 ${12 * scale}px system-ui, sans-serif`;
  context.fillText('N', 0, -radius - 3 * scale);
  context.restore();
}

function drawScaleBar(
  context: CanvasRenderingContext2D,
  left: number,
  y: number,
  bar: ScaleBar,
  scale: number,
): void {
  const thick = 7 * scale;
  const halves = 2;
  const segment = bar.px / halves;

  context.lineWidth = Math.max(1, scale);
  context.strokeStyle = INK;
  for (let index = 0; index < halves; index += 1) {
    context.fillStyle = index % 2 === 0 ? INK : '#ffffff';
    context.fillRect(left + segment * index, y - thick / 2, segment, thick);
  }
  context.strokeRect(left, y - thick / 2, bar.px, thick);

  context.fillStyle = MUTED;
  context.font = `${11 * scale}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText('0', left, y + thick / 2 + 4 * scale);
  context.textAlign = 'right';
  context.fillText(`${bar.length} ${bar.unit}`, left + bar.px, y + thick / 2 + 4 * scale);
}

function drawLegend(
  context: CanvasRenderingContext2D,
  box: { left: number; top: number; width: number; height: number },
  legend: LegendEntry[],
  scale: number,
): void {
  if (legend.length === 0 || box.width <= 0) return;

  const rowHeight = 22 * scale;
  const rows = Math.max(1, Math.floor(box.height / rowHeight));
  const columns = Math.ceil(legend.length / rows);
  const columnWidth = box.width / columns;
  const swatch = 12 * scale;

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.font = `${12 * scale}px system-ui, sans-serif`;

  legend.forEach((entry, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = box.left + column * columnWidth;
    const y = box.top + row * rowHeight + rowHeight / 2;

    context.fillStyle = entry.colour;
    context.fillRect(x, y - swatch / 2, swatch, swatch);
    context.strokeStyle = RULE;
    context.lineWidth = Math.max(1, scale);
    context.strokeRect(x, y - swatch / 2, swatch, swatch);

    context.fillStyle = INK;
    context.fillText(entry.label, x + swatch + 8 * scale, y, columnWidth - swatch - 16 * scale);
  });
}
