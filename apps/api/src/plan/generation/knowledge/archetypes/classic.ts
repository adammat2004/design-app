import type { CandidateParams, FunctionalZone, SiteAnalysis } from '../../design/types.js';
import { isStronglyLinear } from '../../design/site-analysis.js';
import {
  LAWN_FLOOR,
  lawnEnd,
  lawnStart,
  terraceDepth,
  terraceRect,
  type Room,
  type SketchRequest,
} from '../../layout/sketch.js';
import type { GeometryLanguage } from '../../design/composition/types.js';
import { composed } from './composed.js';
import type { LayoutSketch } from '../../layout/sketch.js';
import { curved } from '../../layout/templates/curved.js';
import { formal } from '../../layout/templates/formal.js';
import { rectilinear } from '../../layout/templates/rectilinear.js';
import { clampRect, lawnDepthBehindTerrace, SHALLOW_LAWN, withZoneIds } from './shared.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * The three compositions this generator already drew, named for what they are.
 *
 * `rectilinear` is a terrace with a lawn behind it; `curved` is a sweeping lawn between planted
 * bays; `formal` is an axis. They were picked by `index % 3` and carried no identity on the wire.
 * Here each answers for itself when it suits a plot and when it does not, which is the whole point:
 * a formal axis on a nine-metre-wide courtyard was never a worse plan, it was the wrong one.
 *
 * **They are composed now, not drawn.** Each says only what is particular to it — which shape
 * language it speaks — and `design/composition/` does the rest in the order a designer would: the
 * lawn is reserved first, the rooms go in bays round it, one route runs down a corridor past them,
 * something terminates the view. The hand-drawn templates survive for one case, the courtyard, which
 * has no lawn to compose round; `golden.test.ts` still pins them for exactly that reason.
 */

/**
 * A composed sketch, or the hand-drawn template where the composition declines — a courtyard, or a
 * plot that cannot hold what the brief most wants round a lawn. See `composed.ts`.
 */
function classic(
  id: LayoutArchetype['id'],
  language: GeometryLanguage,
  template: (request: SketchRequest, room: Room, params: CandidateParams) => LayoutSketch,
): Pick<LayoutArchetype, 'sketch' | 'zonePattern'> {
  return composed(id, language, {
    sketch: (request, room, _plan, params) => withZoneIds(template(request, room, params)),
    zonePattern: lawnPlanZones,
  });
}

/** A plot must be at least this deep behind the doors for an axis to be a view rather than a step. */
const AXIS_MIN_DEPTH = 8;

/** And at least this wide, or the "axis" is the only place there was to walk. */
const AXIS_MIN_WIDTH = 5;

/** Below this depth there is no "behind the terrace", so a terrace-and-lawn plan has no lawn. */
const LAWN_PLAN_MIN_DEPTH = 6;

/** The least depth the focal room at the end of the axis takes, from `formal.ts`'s own clamp. */
const AXIS_END_MIN = 2.4;

/**
 * The least width a sweeping lawn needs for the sweep to be visible.
 *
 * Derived rather than picked. `curved.ts` waves the lawn's radius by `LAWN_WAVE` — 13% — so the
 * bulge is about an eighth of the lawn's half-width. On a six-metre room the lawn is three metres
 * across and the bulge is twenty centimetres: drawn, invisible, and indistinguishable from a
 * rectangle somebody failed to draw straight. Nine metres leaves a bulge of about half a metre with
 * a border either side, which reads. The first version refused only below six and offered a
 * naturalistic plan for a corridor.
 */
const CURVE_MIN_WIDTH = 9;

function base(
  id: LayoutArchetype['id'],
  name: string,
  summary: string,
  tone: string,
): Pick<LayoutArchetype, 'id' | 'name' | 'summary' | 'tone'> {
  return { id, name, summary, tone };
}

/**
 * The zone rectangles a terrace-and-lawn plan implies, derived from the same helpers the template
 * uses so the plan and the sketch cannot disagree about where the lawn starts.
 */
function lawnPlanZones(
  zones: FunctionalZone[],
  room: Room,
  params: CandidateParams,
  request: SketchRequest,
): FunctionalZone[] {
  const terrace = terraceRect(request, room, params.terraceDepth);
  const start = lawnStart(request.scale, room.uMax, terrace.u1);
  const end = lawnEnd(request.scale, room.uMax, terrace.u1);

  return zones.map((zone) => {
    if (zone.type === 'terrace') return { ...zone, rect: terrace };
    if (zone.type === 'lawn') {
      return {
        ...zone,
        rect: clampRect({ u0: start, u1: end, v0: room.vMin, v1: room.vMax }, room),
      };
    }
    return zone;
  });
}

export const terraceAndLawn: LayoutArchetype = {
  ...base(
    'terrace_and_lawn',
    'Terrace and lawn',
    'A terrace across the doors, one clean lawn set off-centre so the planting runs deeper down one side, and the gathering places in the far corner.',
    'Structured',
  ),
  circulation: ['direct', 'perimeter'],
  proportions: {
    terrace: { min: 0.12, max: 0.34 },
    lawn: { min: 0.2, max: 0.55 },
    planting: { min: 0.15, max: 0.4 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const reasons: string[] = [];
    /*
     * It needs only enough depth for a lawn behind the terrace; everything past that is preference.
     */
    if ((site.roomDepth ?? 0) < LAWN_PLAN_MIN_DEPTH) {
      return {
        score: 0.15,
        reasons: ['Barely deep enough behind the doors for a lawn as well as a terrace.'],
      };
    }
    if (site.shape === 'courtyard') {
      return { score: 0.1, reasons: ['A courtyard has no room behind the terrace for a lawn.'] };
    }
    reasons.push('A terrace at the doors with one open lawn behind it suits almost any plot.');

    /*
     * The general-purpose answer, but not the answer to everything — and saying so is the point of
     * a site fit. This composition lays its rooms front to back, so a room much wider than it is
     * deep gets a lawn that is a strip: it still *works*, which is why this is 0.6 rather than a
     * refusal, and the side-by-side plan should beat it there.
     */
    /*
     * The measurement this plan stands on: what is left for a lawn once the terrace, the gap and
     * the rear border have taken their depth. Below the floor it is still a legal plan and a poor
     * one, which is a low score rather than a refusal — on a plot where nothing else fits it is
     * still the best answer available.
     */
    const behind = lawnDepthBehindTerrace(site.scale.sizeFactor, site.roomDepth ?? 0);
    if (behind < SHALLOW_LAWN) {
      return {
        score: 0.45,
        reasons: [
          `A terrace, a gap and a rear border leave ${behind.toFixed(1)} m of lawn, which reads as a strip.`,
        ],
      };
    }

    switch (site.shape) {
      case 'square':
        reasons.push('The room behind the doors is squarish, which is what this plan is for.');
        return { score: 0.95, reasons };
      case 'wide':
        reasons.push('Wider than it is deep, but still deep enough for a lawn behind the terrace.');
        return { score: 0.75, reasons };
      case 'long':
        reasons.push('Long enough that the lawn reads as a strip rather than a panel.');
        return { score: 0.65, reasons };
      default:
        return { score: 0.8, reasons };
    }
  },

  params(site, brief) {
    const first = defaultParams('terrace_and_lawn');
    /*
     * Ordered best-first, and the first entry is always the composition as designed. A wide room
     * gets the centred variation offered early because a deep border down one side of a very wide
     * garden leaves the lawn lopsided; a long one gets the squared-up destination, because on the
     * diagonal it ends up nearly behind the planting.
     */
    const wide = (site.roomWidth ?? 0) > (site.roomDepth ?? 1) * 1.2;
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: wide ? 'centre' : 'away' },
      {
        ...first,
        destination: site.shape === 'long' ? 'far-centre' : 'far-diagonal',
        terraceDepth: 1.15,
      },
      { ...first, terraceDepth: 0.85 },
      { ...first, lawnBias: 'away', destination: 'far-centre' },
    ];
    return variants.filter((entry) => brief.style !== 'formal' || entry.lawnBias !== 'away');
  },

  ...classic('terrace_and_lawn', 'rectilinear', rectilinear),
};

export const sweepingLawn: LayoutArchetype = {
  ...base(
    'sweeping_lawn',
    'Sweeping lawn',
    'A flowing lawn that bulges and narrows between deep planted bays, with a path that curves out of sight to a seat at the far end.',
    'Natural',
  ),
  circulation: ['meander', 'perimeter'],
  proportions: {
    terrace: { min: 0.1, max: 0.3 },
    lawn: { min: 0.2, max: 0.5 },
    planting: { min: 0.2, max: 0.45 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const reasons: string[] = [];
    /*
     * A curve needs room to curve in. On a narrow plot the wave amplitude is a wiggle, and on a
     * shallow one the lawn is an ellipse squashed flat — both of which read as a mistake rather
     * than as a naturalistic garden.
     */
    if (
      (site.roomDepth ?? 0) < LAWN_PLAN_MIN_DEPTH + 2 ||
      (site.roomWidth ?? 0) < CURVE_MIN_WIDTH
    ) {
      return refuseSmall(site);
    }
    if (site.shape === 'courtyard') {
      return { score: 0, reasons: ['There is no lawn in a courtyard to sweep.'] };
    }
    reasons.push('Deep planted bays either side of a lawn that opens out towards the far end.');
    return { score: site.shape === 'wide' ? 0.65 : 0.9, reasons };
  },

  params() {
    const first = defaultParams('sweeping_lawn');
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: 'away' },
      { ...first, terraceDepth: 0.85, destination: 'far-centre' },
      { ...first, terraceDepth: 1.15 },
    ];
    return variants;
  },

  ...classic('sweeping_lawn', 'soft_organic', curved),
};

export const formalAxis: LayoutArchetype = {
  ...base(
    'formal_axis',
    'Formal axis',
    'Everything mirrored about the view from the doors: a centred terrace, a paved line down the middle of the lawn, and a focal point at its end.',
    'Formal',
  ),
  circulation: ['axis', 'perimeter'],
  proportions: {
    terrace: { min: 0.12, max: 0.32 },
    lawn: { min: 0.18, max: 0.5 },
    planting: { min: 0.15, max: 0.4 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'utility', 'productive', 'destination', 'water', 'planting'],

  suitability(site) {
    /*
     * **The one composition that refuses outright, and the clearest case for suitability existing
     * at all.** An axis is a long view with something at the end of it. On a room under eight
     * metres deep there is no view, and on one under five wide the "axis" is simply the only place
     * there was to walk — so the plan claims a formality the garden cannot carry. Before this, a
     * formal axis was offered on every plot including a nine-metre courtyard.
     */
    if ((site.roomDepth ?? 0) < AXIS_MIN_DEPTH) {
      return {
        score: 0,
        reasons: [
          `The room behind the doors is ${(site.roomDepth ?? 0).toFixed(1)} m deep, too short for the view an axis is.`,
        ],
      };
    }
    if ((site.roomWidth ?? 0) < AXIS_MIN_WIDTH) {
      return {
        score: 0,
        reasons: [
          'Too narrow for a centred path to read as an axis rather than as the only way through.',
        ],
      };
    }
    if (site.shape === 'irregular') {
      return {
        score: 0.2,
        reasons: ['An irregular plot has no symmetry for a formal plan to mirror about.'],
      };
    }

    /*
     * A formal plan spends depth three times over — the terrace, the lawn panel and the focal room
     * at the end of the axis — and the lawn is what gets squeezed. On a 9 × 10 m room it comes out
     * two metres across, under the floor every other plan respects. Checked with the same helpers
     * the template itself uses, so the refusal and the drawing cannot disagree.
     */
    const depth = site.roomDepth ?? 0;
    const terrace = terraceDepth(site.scale.sizeFactor, depth);
    const panel =
      lawnEnd(site.scale.sizeFactor, depth, terrace) -
      lawnStart(site.scale.sizeFactor, depth, terrace) -
      AXIS_END_MIN;
    if (panel < LAWN_FLOOR.minDimension) {
      return {
        score: 0,
        reasons: [
          `After a terrace, a lawn and a focal point at the end of the axis there would be ${Math.max(0, panel).toFixed(1)} m of lawn left.`,
        ],
      };
    }

    const reasons = ['A long view from the doors with a focal point at the end of it.'];
    return { score: site.shape === 'wide' ? 0.7 : 0.85, reasons };
  },

  params() {
    /*
     * One parameter set, and the two axes it leaves out are the point. Biasing the lawn to one side
     * or moving the focal point off the axis does not vary a formal garden, it stops it being one —
     * and the mirror-symmetry test would be the thing that noticed.
     */
    const first = defaultParams('formal_axis');
    const variants: CandidateParams[] = [
      { ...first, lawnBias: 'centre', destination: 'axis-end' },
      { ...first, lawnBias: 'centre', destination: 'axis-end', terraceDepth: 1.15 },
    ];
    return variants;
  },

  ...classic('formal_axis', 'formal_symmetric', formal),
};

function refuseSmall(site: SiteAnalysis): { score: number; reasons: string[] } {
  return {
    score: 0,
    reasons: [
      `A room ${(site.roomDepth ?? 0).toFixed(1)} × ${(site.roomWidth ?? 0).toFixed(1)} m has no space for a curve to be a curve rather than a wiggle.`,
    ],
  };
}

/** Exported so the selector can mention it; `isStronglyLinear` is the other shape test. */
export { isStronglyLinear };
