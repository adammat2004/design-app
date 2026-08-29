import type { ZoneId } from './zones';

/**
 * One source for zone colour, used by the Konva fill on the plan and by the swatches in the
 * Design areas panel. A plain map rather than CSS custom properties because Konva cannot read
 * variables off the document — splitting them would let the two drift apart.
 */
export const ZONE_COLOURS: Record<ZoneId, string> = {
  front: '#e8a87c',
  back: '#8cb87a',
  left: '#a99ad6',
  right: '#84b3dd',
};

/** Faint enough that the plan still reads as one garden rather than a patchwork. */
export const ZONE_FILL_ALPHA = 0.18;

export function zoneFill(id: ZoneId): string {
  return withAlpha(ZONE_COLOURS[id], ZONE_FILL_ALPHA);
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
