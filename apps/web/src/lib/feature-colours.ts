import type { FeatureStatus } from './features';

/**
 * Keep / Remove / Replace, as colour. The whole point of this screen is that a glance at the
 * plan tells you what is happening to everything on it, so status drives the outline of every
 * placed feature — not a badge you have to open something to see.
 *
 * Sits alongside `zone-colours.ts` and follows its shape. Kept out of the components so the
 * canvas, the list, the legend and the popover cannot drift apart.
 */
export interface StatusStyle {
  /** Outline on the canvas, and the pill's text and border. */
  stroke: string;
  /** Shape fill on the canvas. */
  fill: string;
  /** Pill background. */
  tint: string;
  /** Konva dash pattern, or undefined for a solid line. */
  dash: number[] | undefined;
  /** Removed things are still on the plan, just quieter. */
  opacity: number;
  label: string;
}

export const STATUS_COLOURS: Record<FeatureStatus, StatusStyle> = {
  keep: {
    stroke: '#2f7a3e',
    fill: 'rgba(120, 168, 116, 0.18)',
    tint: '#e8f0e6',
    dash: undefined,
    opacity: 1,
    label: 'Keep',
  },
  remove: {
    stroke: '#c2413a',
    fill: 'rgba(194, 65, 58, 0.08)',
    tint: '#fbeaea',
    dash: [6, 4],
    // Deliberately still visible: removed is a decision about the garden, not a deletion.
    opacity: 0.55,
    label: 'Remove',
  },
  replace: {
    stroke: '#d98324',
    fill: 'rgba(217, 131, 36, 0.12)',
    tint: '#fdf0e0',
    dash: [8, 4],
    opacity: 1,
    label: 'Replace',
  },
};

export const STATUS_ORDER: FeatureStatus[] = ['keep', 'remove', 'replace'];
