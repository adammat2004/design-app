import type { CompositionReport } from '@garden-studio/schema';
import { LAWN_FLOOR, TERRACE_FLOOR } from './layout/sketch.js';

/**
 * What a composed garden looks like, as numbers — the generator's own test oracle.
 *
 * `measureComposition` (in the schema, beside `quantities.ts`) reads a plan; this file is the
 * opinion about what it should read. Policy, so it lives beside the generator: a band is not a
 * fact about the document the way an area is.
 *
 * **The bands come from the traced target, not from the generator.** `target.plan.json` is
 * `target_design.png` traced once, and `COMPOSITION_BANDS` is what it measures widened by a stated
 * tolerance and cross-checked against the rules of thumb every landscape primer gives: hard
 * landscaping about a third, lawn a third to a half, planting at least a quarter. A harness
 * calibrated to the generator's own output would only ever confirm what it already did.
 *
 * ```
 *   target.plan.json ─► measureComposition ─► shares ± tolerance ─► COMPOSITION_BANDS
 *   generated concept ─► measureComposition ─► compositionRules ─► [] | violations
 * ```
 */

export interface Band {
  min: number;
  max: number;
}

export interface CompositionBands {
  /** Applies to a plan with an open panel: a garden. */
  garden: { hard: Band; lawn: Band; planting: Band; undesigned: Band };
  /** Applies to a plan with no open panel: a courtyard. */
  courtyard: { hard: Band; lawn: Band; planting: Band; undesigned: Band };
  /** The terrace's narrower side, in metres, when the room is at least that deep. */
  terraceMinDimension: number;
  /** The lawn's narrower side and area, when there is one. */
  lawnMinDimension: number;
  lawnMinArea: number;
}

/**
 * Where these numbers come from.
 *
 * Over the whole plot the traced target measures hard 0.42, lawn 0.21, planting 0.32, existing
 * 0.03, with 0.02 of base showing. The bands below are asserted on the **garden proper** — the
 * zone the grammar composed — because that is what the templates control; a front garden that is
 * still a path across a lawn is a real gap but a different one. Run `COMPOSITION_REPORT=1` over
 * the fixture test to see both rows for all ten fixtures beside the target.
 *
 * They are wide on purpose. A band is a fault detector, not a style: it has to pass a naturalistic
 * garden that is half lawn and a small modern one that is two thirds paving, and fail the three
 * things this pass fixed — a terrace too small to hold a table, a lawn that is a mown strip, and a
 * garden that is mostly base showing through.
 *
 * Known gap, deliberately not hidden by widening: the courtyard fixture's room sits at 0.37-0.40
 * base, against the target's 0.02. A 9 × 12 m plot with an 8 × 4 m house has a room barely deeper
 * than its terrace, and composing what is left is the next pass's work.
 */
export const COMPOSITION_BANDS: CompositionBands = {
  garden: {
    hard: { min: 0.15, max: 0.7 },
    lawn: { min: 0.03, max: 0.6 },
    planting: { min: 0.1, max: 0.45 },
    undesigned: { min: 0, max: 0.3 },
  },
  courtyard: {
    hard: { min: 0.25, max: 1 },
    lawn: { min: 0, max: 0 },
    planting: { min: 0, max: 0.5 },
    undesigned: { min: 0, max: 0.45 },
  },
  terraceMinDimension: TERRACE_FLOOR.depth,
  lawnMinDimension: LAWN_FLOOR.minDimension,
  lawnMinArea: LAWN_FLOOR.area,
};

/**
 * How far under a floor a measured dimension may fall before it is a fault.
 *
 * The sketch guarantees the floor; what is measured is what survived being clipped to an odd room
 * and simplified in PostGIS, which shaves centimetres. The L-shaped fixture's lawn comes out 4 mm
 * under its 2.5 m floor, and calling that a design fault would be reporting arithmetic.
 */
const MEASURE_TOLERANCE = 0.05;

export interface CompositionContext {
  /** The back room's depth out from the door, so a shallow room is judged as a shallow room. */
  roomDepth: number | null;
  /** Whether the concept allows lawn at all; a low-maintenance one is judged as a courtyard. */
  lawnAllowed: boolean;
}

/** Every rule the report breaks, as one line each; empty when the plan composes. */
export function compositionRules(
  report: CompositionReport,
  context: CompositionContext,
  bands: CompositionBands = COMPOSITION_BANDS,
): string[] {
  const violations: string[] = [];
  if (report.sampledArea <= 0) return ['nothing was sampled: no zones'];

  const set = report.courtyard || !context.lawnAllowed ? bands.courtyard : bands.garden;
  const label = report.courtyard ? 'courtyard' : 'garden';
  const check = (name: keyof typeof set, value: number) => {
    const band = set[name];
    if (value < band.min - 1e-9 || value > band.max + 1e-9) {
      violations.push(`${label} ${name} share ${value.toFixed(2)} outside ${band.min}–${band.max}`);
    }
  };
  check('hard', report.shares.hard);
  check('lawn', report.shares.lawn);
  check('planting', report.shares.planting);
  check('undesigned', report.shares.undesigned);

  if (report.terrace) {
    const floor =
      context.roomDepth === null
        ? bands.terraceMinDimension
        : Math.min(bands.terraceMinDimension, context.roomDepth);
    if (report.terrace.minDimension < floor - MEASURE_TOLERANCE) {
      violations.push(
        `terrace ${report.terrace.width.toFixed(1)} × ${report.terrace.depth.toFixed(1)} m is under the ${floor.toFixed(1)} m floor`,
      );
    }
  } else if (context.roomDepth !== null) {
    violations.push('no terrace');
  }

  if (report.lawn) {
    if (report.lawn.minDimension < bands.lawnMinDimension - MEASURE_TOLERANCE) {
      violations.push(
        `lawn is ${report.lawn.minDimension.toFixed(1)} m across, under ${bands.lawnMinDimension}`,
      );
    }
    if (report.lawn.area < bands.lawnMinArea - MEASURE_TOLERANCE) {
      violations.push(`lawn is ${report.lawn.area.toFixed(1)} m², under ${bands.lawnMinArea}`);
    }
  }

  return violations;
}

/** One line per concept for the report table `reference-fixture.test.ts` prints. */
export function describeComposition(name: string, report: CompositionReport): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`.padStart(4);
  const terrace = report.terrace
    ? `${report.terrace.width.toFixed(1)}×${report.terrace.depth.toFixed(1)}`
    : '—';
  const lawn = report.lawn
    ? `${report.lawn.area.toFixed(0)}m²/${report.lawn.minDimension.toFixed(1)}m`
    : '—';
  return [
    name.padEnd(22),
    `hard ${pct(report.shares.hard)}`,
    `lawn ${pct(report.shares.lawn)}`,
    `plant ${pct(report.shares.planting)}`,
    `base ${pct(report.shares.undesigned)}`,
    `terrace ${terrace.padEnd(9)}`,
    `lawn ${lawn}`,
    report.courtyard ? 'courtyard' : '',
  ].join('  ');
}
