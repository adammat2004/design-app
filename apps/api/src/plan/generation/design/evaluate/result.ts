import type { DesignIssue } from '@garden-studio/schema';

/**
 * What one principle answers: a fraction and everything it found wrong.
 *
 * `score` is 0 to 1 and `null` means the principle **does not apply to this plan** — no location so
 * nothing can be said about shade, no features so nothing can be said about grouping. That is a
 * different answer from zero, and keeping it separate is what lets the weights be redistributed
 * rather than having an unlocated garden marked down for a fact nobody stated.
 */
/**
 * A fault as a principle writes it, before it is stamped with which critic found it.
 *
 * `DesignIssue.source` is defaulted in the schema, so the parsed type requires it — and every
 * principle in this directory is the geometry critic, so repeating `source: 'geometry'` at thirty
 * emitters would be thirty chances to write something else. `scoreSubject` stamps them once on the
 * way out, which is also the shape a vision critic will take: it stamps its own findings, and the
 * repair pipeline downstream cannot tell which produced what.
 */
export type MeasuredIssue = Omit<DesignIssue, 'source'>;

export interface PrincipleResult {
  score: number | null;
  issues: MeasuredIssue[];
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
