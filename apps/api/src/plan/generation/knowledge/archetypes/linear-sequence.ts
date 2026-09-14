import {
  BED_MIN_DEPTH,
  terraceRect,
  terraceSlot,
  type LayoutSketch,
  type LocalPoint,
  type LocalRect,
  type Slot,
} from '../../layout/sketch.js';
import type { CandidateParams } from '../../design/types.js';
import { bed, clampRect, extents, slotIn, withZoneIds } from './shared.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "A sequence of rooms" — the long narrow plan.
 *
 * A corridor garden is the one shape where showing the whole plot from the doors is the mistake. A
 * six-by-twenty-eight-metre plot laid out as terrace, lawn, far corner is a long thin lawn you can
 * see the end of, which reads as exactly what it is: a strip. The move every designer makes instead
 * is to break the length into rooms and stop you seeing past the first one — so the garden is
 * revealed a room at a time and feels longer rather than shorter.
 *
 * Three or four bands along `u`, each the full width of the plot, separated by planting that runs
 * **most of the way across** and alternates sides. The path threads through the gaps, so it swings
 * from one side to the other and no two rooms are in line.
 */

/** Below this depth-to-width ratio the plot is not a corridor and an ordinary plan is better. */
const MIN_RATIO = 1.9;

/** The shortest a room in the sequence may be, front to back. */
const MIN_BAND = 3.2;

/** How much of the width a dividing bed takes, leaving the rest as the way through. */
const DIVIDER_SHARE = 0.62;

export const linearSequence: LayoutArchetype = {
  id: 'linear_sequence',
  name: 'A sequence of rooms',
  summary:
    'The length broken into rooms rather than run as one strip, with planting across the garden between them and a path that swings side to side so you never see the whole plot at once.',
  tone: 'Natural',
  circulation: ['meander', 'direct'],
  proportions: {
    terrace: { min: 0.1, max: 0.3 },
    lawn: { min: 0.12, max: 0.45 },
    planting: { min: 0.2, max: 0.5 },
  },
  hosts: ['terrace', 'dining', 'lawn', 'play', 'utility', 'productive', 'destination', 'planting'],

  suitability(site) {
    const width = site.roomWidth ?? 0;
    const depth = site.roomDepth ?? 0;
    if (width <= 0 || depth <= 0)
      return { score: 0, reasons: ['No room behind the doors to divide.'] };

    const ratio = depth / width;
    if (ratio < MIN_RATIO) {
      return {
        score: 0,
        reasons: [
          `The room behind the doors is ${depth.toFixed(0)} × ${width.toFixed(0)} m, not long enough to be worth dividing.`,
        ],
      };
    }
    if (depth < MIN_BAND * 3) {
      return { score: 0, reasons: ['Too short to make three rooms of any use.'] };
    }

    const reasons = [
      `A ${depth.toFixed(0)} m garden only ${width.toFixed(0)} m wide: broken into rooms it feels longer, run as one strip it feels like a corridor.`,
    ];
    return { score: 0.95, reasons };
  },

  params() {
    const first = defaultParams('linear_sequence');
    const variants: CandidateParams[] = [
      first,
      { ...first, lawnBias: 'away' },
      { ...first, terraceDepth: 0.85 },
    ];
    return variants;
  },

  zonePattern(zones, room, params, request) {
    const rooms = sequence(room, params, request);
    return zones.map((zone) => {
      if (zone.type === 'terrace') return { ...zone, rect: rooms.terrace };
      if (zone.type === 'lawn' || zone.type === 'play') return { ...zone, rect: rooms.middle };
      if (zone.type === 'destination') return { ...zone, rect: rooms.far };
      if (zone.type === 'utility' || zone.type === 'productive')
        return { ...zone, rect: rooms.utility };
      return zone;
    });
  },

  sketch(request, room, _plan, params) {
    const s = request.scale;
    const b = bed(s);
    const { width } = extents(room);
    const rooms = sequence(room, params, request);
    const gate = request.gateSide ?? 'right';

    const slots: Slot[] = [terraceSlot(rooms.terrace, room)];
    if (rooms.besideTerrace) {
      slots.push(slotIn('beside-terrace', 'beside-terrace', rooms.besideTerrace, { turn: true }));
    }
    if (rooms.middle) slots.push(slotIn('lawn-far', 'lawn-far', rooms.middle, { margin: 0.9 }));
    if (rooms.far) slots.push(slotIn('far-room', 'far-room', rooms.far, { margin: 0.5 }));
    if (rooms.utility) slots.push(slotIn('utility', 'utility', rooms.utility, { turn: true }));
    if (rooms.utility2)
      slots.push(slotIn('utility-2', 'utility-2', rooms.utility2, { turn: true }));

    /*
     * The dividers: a bed running most of the way across between one room and the next, with the
     * gap alternating sides. This is the whole composition — without them the plan is a long strip
     * with things standing in it.
     */
    const beds: LayoutSketch['beds'] = [];
    rooms.dividers.forEach((divider, index) => {
      const onMin = index % 2 === (gate === 'right' ? 0 : 1);
      const span = width * DIVIDER_SHARE;
      const rect = clampRect(
        {
          u0: divider.u0,
          u1: divider.u1,
          v0: onMin ? room.vMin : room.vMax - span,
          v1: onMin ? room.vMin + span : room.vMax,
        },
        room,
      );
      if (rect && rect.u1 - rect.u0 >= BED_MIN_DEPTH) {
        beds.push({
          name: index === rooms.dividers.length - 1 ? 'Rear border' : 'Dividing border',
          shape: { kind: 'rect', rect, cornerRadius: request.style === 'cottage' ? 0.8 : 0 },
        });
      }
    });

    /*
     * The far room is planted as well as occupied. Without this the band holds one feature and
     * reads as bare ground for the rest of its depth, which is most of what the first version's
     * 34% of undesigned share was. `remainderPieces` cuts whatever stands there back out of it.
     */
    if (rooms.far) {
      const floor = clampRect(inset(rooms.far, 0.3), room);
      if (floor) {
        beds.push({
          name: 'Specimen border',
          shape: { kind: 'rect', rect: floor, cornerRadius: request.style === 'cottage' ? 0.8 : 0 },
        });
      }
    }

    /* And a shallow run down each long side, so the rooms have edges as well as divisions. */
    for (const [name, v0, v1] of [
      ['Left border', room.vMin, room.vMin + Math.min(b, width * 0.18)],
      ['Right border', room.vMax - Math.min(b, width * 0.18), room.vMax],
    ] as const) {
      const side = clampRect({ u0: rooms.terrace.u1 + 0.3, u1: room.uMax - 0.15, v0, v1 }, room);
      if (side && side.v1 - side.v0 >= BED_MIN_DEPTH) {
        beds.push({ name, shape: { kind: 'rect', rect: side, cornerRadius: 0 } });
      }
    }

    /* The path threads the gaps, which is what makes it swing rather than run straight. */
    const via: LocalPoint[] = rooms.dividers.map((divider, index) => {
      const onMin = index % 2 === (gate === 'right' ? 0 : 1);
      const gapCentre = onMin
        ? room.vMax - (width * (1 - DIVIDER_SHARE)) / 2
        : room.vMin + (width * (1 - DIVIDER_SHARE)) / 2;
      return { u: (divider.u0 + divider.u1) / 2, v: gapCentre };
    });

    const trees: LocalPoint[] = rooms.dividers.map((divider, index) => ({
      u: (divider.u0 + divider.u1) / 2,
      v: index % 2 === 0 ? room.vMin + 1.4 : room.vMax - 1.4,
    }));

    return withZoneIds({
      template: 'rectilinear',
      beds,
      terrace: rooms.terrace,
      /* Gravel where grass is forbidden, never nothing: `lawnCategory` decides what it is made of. */
      lawn: rooms.middle
        ? {
            kind: 'rect',
            rect: inset(rooms.middle, 0.4),
            cornerRadius: request.style === 'cottage' ? 1 : 0,
          }
        : null,
      lawnCategory: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
      slots,
      paths: [
        {
          from: { terrace: true as const },
          via: via.slice(0, 3),
          to: { slot: 'far-room', or: ['lawn-far', 'utility'] },
          name: 'Garden path',
        },
        {
          from: { u: 0, v: (gate === 'right' ? 1 : -1) * width },
          to: { gate: true as const },
          name: 'Side path',
        },
      ],
      trees,
      axisPath: null,
      courtyard: rooms.middle === null,
    });
  },
};

function inset(rect: LocalRect, by: number): LocalRect {
  return { u0: rect.u0 + by, u1: rect.u1 - by, v0: rect.v0 + by, v1: rect.v1 - by };
}

/**
 * The garden cut into bands along its length.
 *
 * Terrace, then as many rooms as the depth supports, then the utility at the very far end where
 * nothing else wants to be. The dividing beds are the gaps between the bands, so the rooms and the
 * planting are one arrangement rather than two that have to be kept in step.
 */
function sequence(
  room: Parameters<LayoutArchetype['zonePattern']>[1],
  params: Parameters<LayoutArchetype['zonePattern']>[2],
  request: Parameters<LayoutArchetype['zonePattern']>[3],
): {
  terrace: LocalRect;
  besideTerrace: LocalRect | null;
  middle: LocalRect | null;
  far: LocalRect | null;
  utility: LocalRect | null;
  utility2: LocalRect | null;
  dividers: { u0: number; u1: number }[];
} {
  const { depth, uMin } = extents(room);
  const s = request.scale;
  const b = bed(s);

  const terrace = terraceRect(request, room, params.terraceDepth);
  const divider = Math.max(BED_MIN_DEPTH, Math.min(b, depth * 0.08));

  /*
   * **Three rooms, sized rather than counted: terrace, open ground, destination.**
   *
   * The first version cut the length into as many equal bands as would fit and gave the lawn the
   * first one. On a 7 × 22 m room that is three bands of five metres, of which two held a feature
   * apiece and nothing else — a third of the garden reading as base showing through, which is what
   * the fixture's composition bands caught. Equal bands is the wrong shape for the idea: a sequence
   * of rooms is one *generous* room you use and a smaller one you walk to, not a row of identical
   * slices.
   *
   * So the far room takes a modest fixed share and the open ground takes the rest.
   */
  const free = Math.max(0, room.uMax - terrace.u1);
  const rear = Math.max(BED_MIN_DEPTH, Math.min(b, free * 0.1));
  const far = Math.min(Math.max(MIN_BAND, 3.8 * s), Math.max(MIN_BAND, (free - rear) * 0.34));
  const middle = free - rear - far - divider * 2;

  const bands: LocalRect[] = [];
  const dividers: { u0: number; u1: number }[] = [];
  let cursor = terrace.u1;

  const push = (depth: number) => {
    if (depth < MIN_BAND) return;
    dividers.push({ u0: cursor, u1: cursor + divider });
    cursor += divider;
    const rect = clampRect({ u0: cursor, u1: cursor + depth, v0: room.vMin, v1: room.vMax }, room);
    if (rect) bands.push(rect);
    cursor += depth;
  };

  push(middle);
  push(far);

  /* The far end of the plot is always a border, whatever the bands came to. */
  dividers.push({ u0: Math.max(cursor, room.uMax - rear), u1: room.uMax });

  const besideTerrace = clampRect(
    { u0: uMin, u1: terrace.u1, v0: terrace.v1 + 0.3, v1: room.vMax - 0.2 },
    room,
  );

  return {
    terrace,
    besideTerrace: besideTerrace && besideTerrace.v1 - besideTerrace.v0 > 1 ? besideTerrace : null,
    middle: bands[0] ?? null,
    far: bands[1] ?? null,
    /*
     * The working areas share the far room rather than taking a band of their own. On a plot this
     * narrow a band to itself would be a room you walk through to reach a shed, and the shed is the
     * thing you walk to least often.
     */
    utility: bands[1] ?? null,
    utility2: null,
    dividers,
  };
}
