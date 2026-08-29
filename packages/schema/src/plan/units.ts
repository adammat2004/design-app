import { z } from 'zod';

/**
 * Everything is stored in metres. The unit is a display preference, so every conversion
 * happens at the edge — reading a value out for a label, or parsing one back in.
 *
 * It lives in the document rather than in browser state because the server formats text too:
 * the assistant's before/after lines are measured off geometry and written in the user's unit.
 */
export const UnitSchema = z.enum(['m', 'ft']);
export type Unit = z.infer<typeof UnitSchema>;

export const METRES_PER_FOOT = 0.3048;

/** Metres -> the number shown in the UI. */
export function toDisplay(metres: number, unit: Unit): number {
  return unit === 'ft' ? metres / METRES_PER_FOOT : metres;
}

/** A number typed in the UI -> metres. */
export function fromDisplay(value: number, unit: Unit): number {
  return unit === 'ft' ? value * METRES_PER_FOOT : value;
}

/**
 * One decimal place, matching the mockup's "12.1 m" labels. Trailing ".0" is kept so the
 * labels do not jitter in width as a vertex is dragged.
 */
export function formatLength(metres: number, unit: Unit): string {
  return `${toDisplay(metres, unit).toFixed(1)} ${unit}`;
}

/** The same number without its unit, for the value of a numeric input. */
export function formatLengthValue(metres: number, unit: Unit): string {
  return toDisplay(metres, unit).toFixed(1);
}

/**
 * Areas are whole numbers — nobody measures a garden to a tenth of a square metre, and the
 * summary column stays legible without the decimals.
 */
export function formatArea(squareMetres: number, unit: Unit): string {
  const value = unit === 'ft' ? squareMetres / (METRES_PER_FOOT * METRES_PER_FOOT) : squareMetres;
  return `${Math.round(value)} ${unit}²`;
}
