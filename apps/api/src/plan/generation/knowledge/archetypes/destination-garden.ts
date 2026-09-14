import {
  BED_MIN_DEPTH,
  lawnEnd,
  lawnStart,
  terraceRect,
  terraceSlot,
  type LayoutSketch,
  type LocalPoint,
  type LocalRect,
  type Slot,
} from '../../layout/sketch.js';
import { bed, clampRect, extents, slotIn, withZoneIds } from './shared.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Somewhere to walk to" — the garden whose point is the far end.
 *
 * The nearest thing to a composition the old generator already had: `wantsLoungeRoom` puts a second
 * seating room on a big plan, and `far-room` exists in every template. What was missing is the
 * *intent*. A destination garden is not a plan with a room at the end of it; it is a plan built so
 * that the room at the end is the reason you go out — the terrace is smaller than it would
 * otherwise be, the route to the far room is deliberate and slightly indirect, and the planting
 * deepens as you go so the far end feels further away than it is.
 *
 * It needs real depth and a reason. A fire pit, a second seat or a garden room at the far end is
 * the reason; without one the walk arrives nowhere and this is just a terrace-and-lawn plan with a
 * longer path.
 */

/** Under this there is nowhere far enough away to be a destination. */
const MIN_DEPTH = 12;

/** The features that can be the thing at the end of the walk. */
const DESTINATIONS = ['firePit', 'gardenRoom', 'hotTub', 'water', 'seating', 'dining'];

export const destinationGarden: LayoutArchetype = {
  id: 'destination_garden',
  name: 'Somewhere to walk to',
  summary:
    'A smaller terrace at the doors and a second place at the far end worth the walk, with the route to it slightly indirect and the planting deepening as you go.',
  tone: 'Natural',
  circulation: ['meander', 'direct'],
  proportions: {
    terrace: { min: 0.08, max: 0.25 },
    lawn: { min: 0.18, max: 0.5 },
    planting: { min: 0.2, max: 0.45 },
  },
  hosts: [
    'terrace',
    'dining',
    'lawn',
    'destination',
    'lounge',
    'utility',
    'productive',
    'planting',
  ],

  suitability(site, brief) {
    const depth = site.roomDepth ?? 0;
    if (depth < MIN_DEPTH) {
      return {
        score: 0,
        reasons: [
          `Only ${depth.toFixed(0)} m deep: nowhere far enough from the house to be worth walking to.`,
        ],
      };
    }

    /*
     * The reason has to exist. A destination garden whose destination is an empty corner is a plan
     * that promises something it does not draw, which is exactly the class of silent fiction the
     * focal strategy refuses to invent.
     */
    const reason = brief.featurePriorities.find((entry) => DESTINATIONS.includes(entry.feature));
    if (!reason) {
      return {
        score: 0,
        reasons: ['Nothing was asked for that would be worth putting at the far end.'],
      };
    }

    return {
      score: brief.focal === 'far-corner' || brief.emphasis === 'planted' ? 0.9 : 0.7,
      reasons: [
        `${depth.toFixed(0)} m is far enough for the far end to be its own place rather than the back of the lawn.`,
      ],
    };
  },

  params() {
    const first = { ...defaultParams('destination_garden'), terraceDepth: 0.85 as const };
    return [first, { ...first, lawnBias: 'away' as const }, { ...first, terraceDepth: 1 as const }];
  },

  zonePattern(zones, room, params, request) {
    const layout = walk(room, params, request);
    return zones.map((zone) => {
      if (zone.type === 'terrace') return { ...zone, rect: layout.terrace };
      if (zone.type === 'lawn' || zone.type === 'play') return { ...zone, rect: layout.lawn };
      if (zone.type === 'destination' || zone.type === 'lounge') {
        /* The destination is the primary room here, so it gets the generous end of the plot. */
        return { ...zone, rect: layout.destination, importance: 'primary' as const };
      }
      if (zone.type === 'utility' || zone.type === 'productive')
        return { ...zone, rect: layout.utility };
      return zone;
    });
  },

  sketch(request, room, _plan, params) {
    const s = request.scale;
    const b = bed(s);
    const { width } = extents(room);
    const layout = walk(room, params, request);
    const gate = request.gateSide ?? 'right';
    const farSign = gate === 'right' ? -1 : 1;

    const slots: Slot[] = [terraceSlot(layout.terrace, room)];
    if (layout.besideTerrace) {
      slots.push(slotIn('beside-terrace', 'beside-terrace', layout.besideTerrace, { turn: true }));
    }
    if (layout.destination) {
      slots.push(slotIn('far-room', 'far-room', layout.destination, { margin: 0.5 }));
    }
    if (layout.lawn) slots.push(slotIn('lawn-far', 'lawn-far', layout.lawn, { margin: 1 }));
    if (layout.utility) slots.push(slotIn('utility', 'utility', layout.utility, { turn: true }));
    if (layout.utility2)
      slots.push(slotIn('utility-2', 'utility-2', layout.utility2, { turn: true }));

    slots.push({
      id: 'terrace-end',
      kind: 'terrace-end',
      zoneId: 'dining',
      anchor: {
        u: layout.terrace.u0 + (layout.terrace.u1 - layout.terrace.u0) / 2,
        v: layout.terrace.v0 - 1.9 * s,
      },
      maxSize: { width: 3.6 * s, depth: Math.max(3, layout.terrace.u1 - layout.terrace.u0) },
      minSize: { width: 3, depth: 3 },
    });

    /*
     * The planting deepens towards the far end: a shallow run beside the terrace, a deep bay
     * two thirds of the way down that the path has to go round, and the rear border behind the
     * destination. That progression is what makes the walk feel like a journey.
     */
    const beds: LayoutSketch['beds'] = [];
    /*
     * The near border runs the **whole way** from the terrace to the pinch, on the same side as the
     * lawn's own deep edge. The first version gave it 45% of the lawn's depth, which on a narrow
     * plot came to about five metres of bed in a 154 m² garden — nine per cent planting, under the
     * floor the composition bands set and under this composition's own stated proportions.
     */
    const near = clampRect(
      {
        u0: layout.terrace.u1 + 0.3,
        u1: Math.max(layout.terrace.u1 + 0.3 + b, layout.pinch - b),
        v0: farSign < 0 ? room.vMin : room.vMax - b,
        v1: farSign < 0 ? room.vMin + b : room.vMax,
      },
      room,
    );
    if (near && near.v1 - near.v0 >= BED_MIN_DEPTH) {
      beds.push({ name: 'Specimen border', shape: { kind: 'rect', rect: near, cornerRadius: 0 } });
    }

    const bay = clampRect(
      {
        u0: layout.pinch - b,
        u1: layout.pinch + b,
        v0: farSign < 0 ? room.vMax - Math.min(width * 0.5, 4.4 * s) : room.vMin,
        v1: farSign < 0 ? room.vMax : room.vMin + Math.min(width * 0.5, 4.4 * s),
      },
      room,
    );
    if (bay) {
      beds.push({
        name: 'Flowering border',
        shape: { kind: 'rect', rect: bay, cornerRadius: request.style === 'cottage' ? 1 : 0 },
      });
    }

    const rear = clampRect(
      { u0: room.uMax - b, u1: room.uMax, v0: room.vMin + 0.15, v1: room.vMax - 0.15 },
      room,
    );
    if (rear)
      beds.push({ name: 'Rear border', shape: { kind: 'rect', rect: rear, cornerRadius: 0 } });

    const trees: LocalPoint[] = [
      /* One either side of the pinch, so the far end is glimpsed rather than seen. */
      { u: layout.pinch, v: farSign < 0 ? room.vMax - 1.6 : room.vMin + 1.6 },
      { u: room.uMax - 1.9, v: room.vMin + 1.9 },
      { u: room.uMax - 1.9, v: room.vMax - 1.9 },
    ];

    return withZoneIds({
      template: 'rectilinear',
      beds,
      terrace: layout.terrace,
      /* Gravel where grass is forbidden, never nothing: `lawnCategory` decides what it is made of. */
      lawn: layout.lawn
        ? {
            kind: 'rect',
            rect: layout.lawn,
            cornerRadius: request.style === 'cottage' ? 1.2 : 0,
          }
        : null,
      lawnCategory: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
      slots,
      paths: [
        {
          from: { terrace: true as const },
          /* Round the deep bay rather than straight past it: the indirectness is the composition. */
          via: [{ u: layout.pinch, v: farSign * Math.min(width * 0.22, 2.4 * s) }],
          to: { slot: 'far-room', or: ['lawn-far'] },
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
      courtyard: false,
    });
  },
};

/** The terrace, the lawn between, the pinch two thirds down, and the room at the end. */
function walk(
  room: Parameters<LayoutArchetype['zonePattern']>[1],
  params: Parameters<LayoutArchetype['zonePattern']>[2],
  request: Parameters<LayoutArchetype['zonePattern']>[3],
): {
  terrace: LocalRect;
  besideTerrace: LocalRect | null;
  lawn: LocalRect | null;
  destination: LocalRect | null;
  utility: LocalRect | null;
  utility2: LocalRect | null;
  pinch: number;
} {
  const { width, uMin } = extents(room);
  const s = request.scale;
  const b = bed(s);
  const gate = request.gateSide ?? 'right';

  const terrace = terraceRect(request, room, params.terraceDepth);

  /* The destination takes the far band, sized to hold a room rather than an ornament. */
  const roomDepth = Math.min(Math.max(3.4, 3.8 * s), (room.uMax - terrace.u1) * 0.32);
  const destination = clampRect(
    {
      u0: room.uMax - b - roomDepth,
      u1: room.uMax - b,
      v0: -Math.min(width * 0.4, 2.4 * s),
      v1: Math.min(width * 0.4, 2.4 * s),
    },
    room,
  );

  const start = lawnStart(request.scale, room.uMax, terrace.u1);
  const end = Math.min(
    lawnEnd(request.scale, room.uMax, terrace.u1),
    destination ? destination.u0 - 0.6 : room.uMax - b,
  );
  const deepOnMin = params.lawnBias === 'away' ? gate !== 'right' : gate === 'right';
  const lawn =
    end - start >= 2.5
      ? clampRect(
          {
            u0: start,
            u1: end,
            v0: room.vMin + (deepOnMin ? b : 0.35),
            v1: room.vMax - (deepOnMin ? 0.35 : b),
          },
          room,
        )
      : null;

  const besideTerrace = clampRect(
    { u0: uMin, u1: terrace.u1, v0: terrace.v1 + 0.3, v1: room.vMax - 0.2 },
    room,
  );

  const utilityWidth = Math.min(3.2 * s, width * 0.3);
  const utility = clampRect(
    {
      u0: Math.max(terrace.u1 + 0.6, room.uMax - b - roomDepth),
      u1: room.uMax - b,
      v0: gate === 'right' ? room.vMax - utilityWidth : room.vMin,
      v1: gate === 'right' ? room.vMax : room.vMin + utilityWidth,
    },
    room,
  );

  return {
    terrace,
    besideTerrace: besideTerrace && besideTerrace.v1 - besideTerrace.v0 > 1 ? besideTerrace : null,
    lawn,
    destination,
    utility,
    utility2: null,
    /* Two thirds of the way down, which is where a garden should stop showing you the rest of it. */
    pinch: terrace.u1 + (room.uMax - terrace.u1) * 0.62,
  };
}
