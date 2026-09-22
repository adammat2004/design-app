import { designedBeds } from '../../layout/beds.js';
import {
  BED_MIN_DEPTH,
  isCourtyard,
  LAWN_FLOOR,
  terraceDepth,
  terraceFloor,
  terraceRect,
  terraceSlot,
  type LayoutSketch,
  type LocalPoint,
  type LocalRect,
  type Slot,
} from '../../layout/sketch.js';
import type { CandidateParams } from '../../design/types.js';
import {
  bed,
  clampRect,
  extents,
  lawnDepthBehindTerrace,
  SHALLOW_LAWN,
  slotIn,
  withZoneIds,
} from './shared.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Terrace and lawn, side by side" — the wide shallow plan.
 *
 * The composition the three original templates could not express, and the reason a wide shallow
 * garden came out badly. All three of them lay their rooms **along `u`**: terrace at the doors,
 * lawn behind it, destination behind that. On a plot twenty-two metres across and nine deep there
 * is no "behind" — after a terrace and a rear border the lawn is a strip — so the plan either
 * refused the lawn or drew one two metres from front to back.
 *
 * Here the rooms are laid along `v` instead, which is where the space actually is: the terrace on
 * the doors, the lawn beside it running the full depth, the utility corner at the far end of the
 * wall and planting along the back and the two ends. Nothing is behind anything.
 */

/** Below this width there is nothing to lay side by side, and the ordinary plan is better. */
const MIN_WIDTH = 12;

/**
 * How much of a shallow room's depth the terrace may take.
 *
 * More than the third the other compositions allow, because here the lawn is beside it rather than
 * behind it and the depth is not being shared. Less than all of it, because paving the whole depth
 * of a garden makes a yard rather than a room.
 */
const TERRACE_SHARE = 0.6;

/**
 * How much room the way in from the gate needs, in metres.
 *
 * **Wider than `PASSAGE_ACCESS_WIDTH`, and the difference is the whole point.** That constant is
 * one metre, which is what a person needs to walk past a house; the route drawn here is the
 * `access` circulation, which `circulationFor` makes **1.2 m** wide — so a one-metre lane cannot
 * hold it and `routeBetween` refused the side path outright, leaving a gate nobody could walk
 * through. 1.6 m is the route plus a little either side, which is what it takes for a strip
 * centred by the router to stay inside the fence.
 */
const ACCESS_LANE = 1.6;

/** Past this depth-to-width ratio the plot is not shallow and the long-axis plans win. */
const MAX_RATIO = 0.75;

/**
 * The least a lawn beside a terrace may be across.
 *
 * `LAWN_FLOOR`, the floor every other composition already uses, rather than a number of this
 * file's own. The first version said four metres, which looks reasonable and is a *second* answer
 * to a question that was already settled — on the main test fixture it refused a 3.8 m wide, 26 m²
 * lawn, so the plan came out with no open ground at all.
 */
const LAWN_MIN_WIDTH = LAWN_FLOOR.minDimension;

export const sideBySide: LayoutArchetype = {
  id: 'side_by_side',
  name: 'Terrace and garden side by side',
  summary:
    'The terrace on the doors and the lawn beside it rather than behind, so a wide shallow plot reads as two rooms across the garden instead of one strip.',
  tone: 'Structured',
  circulation: ['direct', 'perimeter'],
  proportions: {
    terrace: { min: 0.15, max: 0.4 },
    lawn: { min: 0.15, max: 0.5 },
    planting: { min: 0.15, max: 0.4 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const width = site.roomWidth ?? 0;
    const depth = site.roomDepth ?? 0;

    if (width < MIN_WIDTH) {
      return {
        score: 0,
        reasons: [`Only ${width.toFixed(1)} m across: there is nothing to lay side by side.`],
      };
    }
    /*
     * The bands run the full depth and the full width, so this composition assumes a rectangle. On
     * an L the lawn band is laid across the notch, the clip takes most of it away and the plan comes
     * out with no open ground at all — which is what the l-shape fixture's composition bands caught.
     */
    if (site.shape === 'irregular') {
      return {
        score: 0,
        reasons: [
          'The room behind the doors is not a rectangle, so bands across it fall outside it.',
        ],
      };
    }
    if (depth <= 0 || depth / width > MAX_RATIO) {
      return {
        score: 0,
        reasons: [
          'The room behind the doors is deeper than it is wide, so the rooms belong in sequence.',
        ],
      };
    }
    if (
      width - terraceFloor({ uMin: 0, uMax: depth, vMin: -width / 2, vMax: width / 2 }).width <
      LAWN_MIN_WIDTH
    ) {
      return {
        score: 0,
        reasons: ['No room for a lawn beside the terrace once the terrace has its floor.'],
      };
    }

    /*
     * And the room has to be deep enough to hold one at all. This composition's whole premise is a
     * lawn *beside* a terrace; on a room too shallow for any lawn it draws a terrace, a border and
     * bare ground, which is what a courtyard plan is for. `isCourtyard` is the shared rule the
     * sketch layer already uses, rather than a depth of this file's own.
     */
    if (isCourtyard(site.scale.sizeFactor, depth, width)) {
      return {
        score: 0,
        reasons: [
          `Only ${depth.toFixed(1)} m deep: no lawn fits beside the terrace or anywhere else.`,
        ],
      };
    }

    /*
     * **Scored on how much lawn would be left behind a terrace, not on the ratio.** A room twice as
     * wide as it is deep leaves a generous lawn at twenty metres deep and a two-metre strip at
     * eleven; the ratio is the same and the right plan is not. Where the strip is what is left, this
     * composition is the answer rather than a preference.
     */
    const behind = lawnDepthBehindTerrace(site.scale.sizeFactor, depth);
    const reasons = [
      behind < SHALLOW_LAWN
        ? `A lawn behind the terrace would be ${behind.toFixed(1)} m deep across ${width.toFixed(0)} m, so the rooms go beside each other instead.`
        : `The garden is ${width.toFixed(0)} m across and ${depth.toFixed(0)} m deep, so the rooms can go beside each other rather than behind.`,
    ];
    return { score: behind < SHALLOW_LAWN ? 0.95 : 0.7, reasons };
  },

  params() {
    const first = defaultParams('side_by_side');
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: 'away' },
      { ...first, terraceDepth: 1.15 },
    ];
    return variants;
  },

  zonePattern(zones, room, params, request) {
    const layout = bands(room, params, request);
    return zones.map((zone) => {
      if (zone.type === 'terrace') return { ...zone, rect: layout.terrace };
      if (zone.type === 'lawn') return { ...zone, rect: layout.lawn };
      if (zone.type === 'utility' || zone.type === 'productive') {
        return { ...zone, rect: layout.utility };
      }
      if (zone.type === 'destination' || zone.type === 'play') {
        return { ...zone, rect: layout.destination };
      }
      return zone;
    });
  },

  sketch(request, room, _plan, params) {
    const { depth, width, uMin } = extents(room);
    const s = request.scale;
    const b = bed(s);
    const layout = bands(room, params, request);
    const gate = request.gateSide ?? 'right';

    const terrace = layout.terrace;
    const slots: Slot[] = [terraceSlot(terrace, room)];

    /*
     * Beside the terrace on the house wall, on the far side from the lawn: the outdoor kitchen,
     * which wants to be within reach of the door and out of the route onto the grass.
     */
    const besideRect = clampRect(
      {
        u0: uMin,
        u1: uMin + Math.min(1.8 * s, depth * 0.3),
        v0: layout.utilityOnMin ? room.vMin + 0.3 : terrace.v1 + 0.3,
        v1: layout.utilityOnMin ? terrace.v0 - 0.3 : room.vMax - 0.3,
      },
      room,
    );
    if (besideRect)
      slots.push(slotIn('beside-terrace', 'beside-terrace', besideRect, { turn: true }));

    /* The dining room at the terrace's far end, still on the wall and still off the grass. */
    const endRect = clampRect(
      {
        u0: uMin,
        u1: uMin + Math.min(3.6 * s, depth - b - 0.4),
        v0: layout.utilityOnMin ? terrace.v1 + 0.3 : room.vMin + 0.3,
        v1: layout.utilityOnMin ? room.vMax - 0.3 : terrace.v0 - 0.3,
      },
      room,
    );
    if (endRect) slots.push(slotIn('terrace-end', 'terrace-end', endRect));

    if (layout.utility) slots.push(slotIn('utility', 'utility', layout.utility, { turn: true }));
    if (layout.destination) slots.push(slotIn('far-room', 'far-room', layout.destination));
    if (layout.lawn) {
      const far = clampRect(
        { u0: layout.lawn.u0, u1: layout.lawn.u1, v0: layout.lawn.v0, v1: layout.lawn.v1 },
        room,
      );
      if (far) slots.push(slotIn('lawn-far', 'lawn-far', far, { margin: 0.8 }));
    }

    /* The corner of the terrace furthest from the door: a tub, or a small water feature. */
    slots.push({
      id: 'terrace-corner',
      kind: 'terrace-corner',
      zoneId: 'terrace',
      anchor: {
        u: terrace.u1 - 0.9 * s,
        v: layout.utilityOnMin ? terrace.v1 - 0.9 * s : terrace.v0 + 0.9 * s,
      },
      maxSize: { width: 1.9 * s, depth: 1.9 * s },
    });

    /*
     * Planting along the back and both ends, and never behind the terrace — the terrace runs to
     * within a border of the fence, and a bed squeezed in behind it would be a strip nobody plants.
     */
    const beds: LayoutSketch['beds'] = [];
    const rear = clampRect(
      { u0: room.uMax - b, u1: room.uMax, v0: room.vMin + 0.15, v1: room.vMax - 0.15 },
      room,
    );
    if (rear && rear.u1 - rear.u0 >= BED_MIN_DEPTH) {
      beds.push({ name: 'Rear border', shape: { kind: 'rect', rect: rear, cornerRadius: 0 } });
    }
    for (const [name, v0, v1] of [
      ['Left border', room.vMin, room.vMin + b],
      ['Right border', room.vMax - b, room.vMax],
    ] as const) {
      const end = clampRect({ u0: uMin + 0.15, u1: room.uMax - b - 0.15, v0, v1 }, room);
      if (end && end.v1 - end.v0 >= BED_MIN_DEPTH && end.u1 - end.u0 >= BED_MIN_DEPTH) {
        beds.push({ name, shape: { kind: 'rect', rect: end, cornerRadius: 0 } });
      }
    }

    const trees: LocalPoint[] = [
      { u: room.uMax - 1.9, v: room.vMin + 1.9 },
      { u: room.uMax - 1.9, v: room.vMax - 1.9 },
      { u: room.uMax - 1.9, v: (room.vMin + room.vMax) / 2 },
    ];

    return withZoneIds({
      /*
       * `template` is the geometry family the painters and the fitter know about, and there are
       * still three of those. A new *composition* is not a new kind of shape — this is rectilinear
       * geometry arranged differently — so it reports the family it draws in rather than growing
       * the union for a name.
       */
      template: 'rectilinear',
      beds: beds.length > 0 ? beds : designedBeds(request, room, terrace, 'rectilinear'),
      terrace,
      lawn: layout.lawn ? { kind: 'rect', rect: layout.lawn, cornerRadius: 0 } : null,
      lawnCategory: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
      slots,
      /*
       * The side path is about the gate, not about the lawn, so it is drawn either way. The first
       * version gated both paths on there being a lawn and a plan without one lost its route in
       * from the street — which the path test noticed.
       */
      paths: [
        ...(layout.lawn
          ? [
              {
                from: { terrace: true as const },
                to: { slot: 'far-room', or: ['lawn-far', 'utility'] },
                name: 'Garden path',
              },
            ]
          : []),
        {
          from: { u: 0, v: (gate === 'right' ? 1 : -1) * width },
          /*
           * No `via`. The band against the house wall is clear, so the straight run from the gate
           * to the terrace is both the shortest route and the only one whose strip stays inside the
           * fence — steering it round would be adding a corner to avoid something that is no longer
           * there.
           */
          to: { gate: true as const },
          name: 'Side path',
        },
      ],
      trees,
      axisPath: null,
      courtyard: layout.lawn === null,
    });
  },
};

/**
 * The bands across the garden: terrace, lawn, utility, with the planting round them.
 *
 * One function, called by both `zonePattern` and `sketch`, so the rooms the plan describes are the
 * rooms the sketch draws. That is the arrangement the four new compositions are built on and the
 * one the three originals will move to when the golden comparison is deleted.
 */
function bands(
  room: Parameters<LayoutArchetype['zonePattern']>[1],
  params: Parameters<LayoutArchetype['zonePattern']>[2],
  request: Parameters<LayoutArchetype['zonePattern']>[3],
): {
  terrace: LocalRect;
  lawn: LocalRect | null;
  utility: LocalRect | null;
  destination: LocalRect | null;
  utilityOnMin: boolean;
} {
  const { depth, width, uMin } = extents(room);
  const s = request.scale;
  const b = bed(s);
  const gate = request.gateSide ?? 'right';

  /*
   * **Which side the lawn takes is decided by which side has the room, not by the gate.**
   *
   * The terrace is centred on the door, so the two gaps beside it are whatever the door's position
   * leaves — and on a door well off centre they are nothing alike. The first version put the
   * utility on the gate's side and gave the lawn whatever was left, which on the 20 × 9 m test plot
   * was a two-metre strip: under the four-metre floor, so the plan came out with no lawn at all.
   *
   * The lawn takes the bigger gap and the utility takes the other. The gate only breaks a tie,
   * which is the right precedence: you can carry a bin an extra few metres, and a lawn under four
   * metres across is not a lawn.
   */
  const gapMin = sizedFor(room, params, request).v0 - room.vMin;
  const gapMax = room.vMax - sizedFor(room, params, request).v1;
  const utilityOnMin = Math.abs(gapMin - gapMax) < 1 ? gate !== 'right' : gapMin < gapMax;

  /*
   * The terrace is generous in depth but **not the whole garden**.
   *
   * On a shallow plot the terrace has nowhere to go but sideways, so it takes more of the depth
   * than the other compositions give it — and the first version took *all* of it, less the rear
   * border. That produces a seven-metre-deep slab of paving on a nine-metre garden, which is a
   * yard: the fixture test caught it as a small plot's terrace coming out bigger than an estate's.
   *
   * At least the depth it would have had anyway, at most `TERRACE_SHARE` of the room, and never
   * into the rear border.
   */
  const terraceDeep = Math.max(
    0,
    Math.min(
      depth - b - 0.3,
      Math.max(terraceDepth(request.scale, depth, params.terraceDepth), depth * TERRACE_SHARE),
    ),
  );
  const sized = sizedFor(room, params, request);
  const terrace: LocalRect = {
    u0: uMin,
    u1: uMin + Math.max(terraceFloor(room).depth, terraceDeep),
    v0: sized.v0,
    v1: sized.v1,
  };

  /*
   * The utility strip at one end of the wall, **held off the fence by an access lane**.
   *
   * The lane is not tidiness. The side gate is in a side fence and the shed goes on the gate's
   * side, so with the strip run right up to the fence the store stands squarely in the way of the
   * only route in from the street — and `routeBetween` refused the side path outright rather than
   * squeezing past it. The plan came out with a gate nobody could walk through.
   *
   * One metre, which is `PASSAGE_ACCESS_WIDTH`: the same width a side return has to leave for the
   * same reason, and the same number rather than a second one.
   */
  const utilityWidth = Math.min(3.2 * s, Math.max(0, width * 0.2));
  /*
   * **The strip is anchored to the far end of the terrace's depth, leaving the band against the
   * house wall clear.** That band is the way in from the side gate, and it has to be kept clear for
   * a reason about the router rather than about taste: a gate sits *on* a fence, so the strip
   * `polylineStrip` draws round the first leg of a route out of one is only inside the plot if that
   * leg runs **perpendicular to the fence**. A route that has to turn and run along the fence puts
   * its own square end cap through it and is refused.
   *
   * A side gate is beside the house by convention — it is what `suggestedGateEdge` produces and
   * what a side gate is for — so the clear band is where the route needs it. With the strip against
   * the wall instead, the garden store stood squarely in the only line the route could take and the
   * plan came out with a gate nobody could walk through.
   */
  const stripDepth = Math.min(3.6 * s, Math.max(1.5, terrace.u1 - uMin - ACCESS_LANE));
  const utility = clampRect(
    utilityOnMin
      ? {
          u0: Math.max(uMin + ACCESS_LANE, terrace.u1 - stripDepth),
          u1: terrace.u1,
          v0: room.vMin + 0.3,
          v1: room.vMin + 0.3 + utilityWidth,
        }
      : {
          u0: Math.max(uMin + ACCESS_LANE, terrace.u1 - stripDepth),
          u1: terrace.u1,
          v0: room.vMax - 0.3 - utilityWidth,
          v1: room.vMax - 0.3,
        },
    room,
  );

  /*
   * The lawn is on the opposite side of the terrace from the utility, which is the whole point of
   * choosing the sides that way round: the two never compete for the same gap.
   */
  /*
   * The two borders that bound the lawn take what the gap can spare, not what the style wants.
   *
   * Both are `bed(s, span)`: the side bed shares the gap beside the terrace with the lawn's width
   * and the rear bed shares the room's depth with the lawn's depth, so neither can take the panel
   * under its own floor. See `bed` for what that rule is answering.
   */
  const gap = utilityOnMin ? room.vMax - (terrace.v1 + 0.4) : terrace.v0 - 0.4 - room.vMin;
  const sideBed = bed(s, gap);
  const rearBed = bed(s, room.uMax - (uMin + 0.4));

  const lawnV0 = utilityOnMin ? terrace.v1 + 0.4 : room.vMin + sideBed;
  const lawnV1 = utilityOnMin ? room.vMax - sideBed : terrace.v0 - 0.4;
  const lawnRect =
    lawnV1 - lawnV0 >= LAWN_MIN_WIDTH
      ? clampRect({ u0: uMin + 0.4, u1: room.uMax - rearBed, v0: lawnV0, v1: lawnV1 }, room)
      : null;
  /*
   * Both dimensions and the area, which is what makes a panel a lawn rather than a strip.
   *
   * **Not gated on `lawnAllowed`.** A concept that may not have grass still has open ground; it is
   * gravel instead, which is what `lawnCategory` is for. Dropping the panel outright left a
   * low-upkeep plan with no ground cover at all — 72% of the garden reading as base showing
   * through on the narrow fixture, which the composition bands caught.
   */
  const lawn =
    lawnRect &&
    lawnRect.u1 - lawnRect.u0 >= LAWN_FLOOR.minDimension &&
    (lawnRect.u1 - lawnRect.u0) * (lawnRect.v1 - lawnRect.v0) >= LAWN_FLOOR.area
      ? lawnRect
      : null;

  /* The destination sits at the far corner of the lawn, against the rear border. */
  const destination = lawn
    ? clampRect(
        {
          u0: Math.max(lawn.u0, lawn.u1 - 3.4 * s),
          u1: lawn.u1,
          v0: utilityOnMin ? lawn.v1 - 3.6 * s : lawn.v0,
          v1: utilityOnMin ? lawn.v1 : lawn.v0 + 3.6 * s,
        },
        room,
      )
    : clampRect({ u0: uMin + 0.4, u1: room.uMax - rearBed, v0: lawnV0, v1: lawnV1 }, room);

  return { terrace, lawn, utility, destination, utilityOnMin };
}

/** The terrace's span along the wall, which both the side choice and the terrace itself read. */
function sizedFor(
  room: Parameters<LayoutArchetype['zonePattern']>[1],
  params: Parameters<LayoutArchetype['zonePattern']>[2],
  request: Parameters<LayoutArchetype['zonePattern']>[3],
): LocalRect {
  return terraceRect(request, room, params.terraceDepth);
}
