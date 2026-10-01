import { boundingBox, type Point } from '../../geometry/primitives.js';

/**
 * Lining a shape up with the lines other things offer — "is this wall level with that fence post",
 * "is this path edge level with that patio edge". Moved from the web app with the rest of the
 * snapping; `reach` is optional on both functions so a caller can pass a threshold that scales with
 * zoom, and every caller that passes nothing behaves exactly as it did.
 */

export interface AlignmentGuide {
  axis: 'x' | 'y';
  /** Metres along that axis — the canvas draws a full-height or full-width line here. */
  at: number;
}

/** Within this much, an edge counts as lined up — in metres. */
export const ALIGNMENT_THRESHOLD = 0.3;

/**
 * The coordinates a shape can line itself up against, split by axis. Building the targets
 * separately from the matching is what lets one engine serve "is this wall level with that
 * fence post" on step 1 and "is this path edge level with that patio edge" on step 2.
 */
export interface SnapTargets {
  x: number[];
  y: number[];
}

/** The three lines any shape offers on each axis: its two edges and its middle. */
export function boxSnapLines(polygon: Point[]): SnapTargets {
  if (polygon.length === 0) return { x: [], y: [] };

  const box = boundingBox(polygon);

  return {
    x: [box.minX, box.minX + box.width / 2, box.minX + box.width],
    y: [box.minY, box.minY + box.length / 2, box.minY + box.length],
  };
}

/** Every corner of a polygon as a snap target, which is how the boundary contributes. */
export function cornerSnapLines(polygon: Point[]): SnapTargets {
  return { x: polygon.map((point) => point.x), y: polygon.map((point) => point.y) };
}

export function collectSnapTargets(sources: SnapTargets[]): SnapTargets {
  return {
    x: sources.flatMap((source) => source.x),
    y: sources.flatMap((source) => source.y),
  };
}

/**
 * The lines a shape has come into agreement with — what the canvas draws as a dashed guide.
 * Deduplicated per axis so two features lined up on the same coordinate flash one line.
 */
export function alignmentGuidesFor(
  subject: Point[],
  targets: SnapTargets,
  reach: number = ALIGNMENT_THRESHOLD,
): AlignmentGuide[] {
  if (subject.length === 0) return [];

  const candidates = boxSnapLines(subject);
  const guides: AlignmentGuide[] = [];

  for (const axis of ['x', 'y'] as const) {
    for (const value of candidates[axis]) {
      const match = targets[axis].find((target) => Math.abs(target - value) <= reach);
      if (match === undefined) continue;
      if (guides.some((guide) => guide.axis === axis && Math.abs(guide.at - match) < 1e-6)) {
        continue;
      }

      guides.push({ axis, at: match });
    }
  }

  return guides;
}

/**
 * How far to nudge a shape so it lands on whatever it is nearly lined up with, per axis. Snap
 * uses the same threshold the guides display at, so the line the user sees is the line they get,
 * and the nearest match wins when several are in range.
 */
export function snapDeltaToTargets(
  subject: Point[],
  targets: SnapTargets,
  reach: number = ALIGNMENT_THRESHOLD,
): Point {
  if (subject.length === 0) return { x: 0, y: 0 };

  const candidates = boxSnapLines(subject);
  const delta = { x: 0, y: 0 };

  for (const axis of ['x', 'y'] as const) {
    let best: { delta: number; distance: number } | null = null;

    for (const value of candidates[axis]) {
      for (const target of targets[axis]) {
        const distance = Math.abs(target - value);
        if (distance > reach) continue;
        if (!best || distance < best.distance) best = { delta: target - value, distance };
      }
    }

    if (best) delta[axis] = best.delta;
  }

  return delta;
}

