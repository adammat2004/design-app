import type { DesignIssue } from '@garden-studio/schema';

/**
 * What one principle answers: a fraction and everything it found wrong.
 *
 * `score` is 0 to 1 and `null` means the principle **does not apply to this plan** — no location so
 * nothing can be said about shade, no features so nothing can be said about grouping. That is a
 * different answer from zero, and keeping it separate is what lets the weights be redistributed
 * rather than having an unlocated garden marked down for a fact nobody stated.
 */
export interface PrincipleResult {
  score: number | null;
  issues: DesignIssue[];
}

/** A principle that found nothing to say. */
export const NOT_APPLICABLE: PrincipleResult = { score: null, issues: [] };

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The mean of what was measured, or `null` when nothing was. */
export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return clamp01(values.reduce((total, value) => total + value, 0) / values.length);
}
