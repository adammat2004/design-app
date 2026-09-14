import {
  BED_MIN_DEPTH,
  isCourtyard,
  terraceFloor,
  terraceSlot,
  type LayoutSketch,
  type LocalPoint,
  type LocalRect,
  type Slot,
} from '../../layout/sketch.js';
import { bed, clampRect, extents, slotIn, withZoneIds } from './shared.js';
import { defaultParams, type LayoutArchetype } from './types.js';

/**
 * "Courtyard" — the small garden that is a room rather than a view.
 *
 * The three original templates all handle a courtyard by *giving up*: `isCourtyard` turns true, the
 * lawn is dropped, and what is left is a terrace with one slot in the leftover space. That is an
 * honest fallback and it is not a composition — the plan comes out as paving with a shed on it, and
 * the fixture bands record the consequence, 37 to 45% of the ground reading as base showing through.
 *
 * A courtyard designed as a courtyard is the opposite of a garden designed as a view. The paving is
 * the floor of the room and runs corner to corner; the planting is deep against the walls rather
 * than a token strip; there is one thing worth looking at on the wall opposite the doors; and
 * nothing is in the middle, because the middle is where you stand.
 */

/**
 * What makes a garden a courtyard.
 *
 * `isCourtyard` — the rule the sketch layer already uses to decide whether a plan gets a lawn at
 * all. Reusing it rather than declaring an area threshold of this file's own is the whole point: a
 * second answer to "is this a courtyard" is exactly the kind of drift that had a 9 × 10 m garden
 * paved corner to corner because ninety square metres happened to be under the number chosen here.
 */

/** The deepest a wall bed goes: past this the room stops being a room. */
const MAX_BED_SHARE = 0.28;

export const courtyard: LayoutArchetype = {
  id: 'courtyard',
  name: 'Courtyard',
  summary:
    'A paved floor corner to corner with deep planting against the walls and one thing worth looking at opposite the doors. Nothing in the middle, because the middle is where you stand.',
  tone: 'Structured',
  circulation: ['direct'],
  proportions: {
    terrace: { min: 0.35, max: 0.75 },
    lawn: { min: 0, max: 0.1 },
    planting: { min: 0.2, max: 0.5 },
  },
  hosts: ['terrace', 'dining', 'planting', 'water', 'destination', 'utility'],

  suitability(site, brief) {
    const depth = site.roomDepth ?? 0;
    const width = site.roomWidth ?? 0;

    if (depth <= 0 || width <= 0) {
      return { score: 0, reasons: ['No room behind the doors at all.'] };
    }

    /*
     * Two ways to earn this: no lawn will fit, or none was wanted. A minimalist garden with no
     * grass in it is a courtyard whatever its size, and treating it as a lawn plan with the lawn
     * taken out is how a large one came out as gravel with things standing on it.
     */
    const noLawn = brief.excludedFeatures.some((entry) => entry.feature === 'lawn');
    const noRoomForLawn = isCourtyard(site.scale.sizeFactor, depth, width);

    if (!noLawn && !noRoomForLawn) {
      return {
        score: 0,
        reasons: [
          `${Math.round(depth * width)} m² behind the doors, which holds a lawn — and a courtyard is a garden that does not.`,
        ],
      };
    }

    const reasons = noLawn
      ? [
          'No lawn was wanted, so the paving is the floor of the garden rather than a terrace on it.',
        ]
      : [`No lawn fits behind the doors: a room to be in rather than a view to look at.`];

    return { score: 0.95, reasons };
  },

  params() {
    /* Nothing to vary: there is one way to lay a small paved room out and this is it. */
    return [defaultParams('courtyard')];
  },

  zonePattern(zones, room, _params, request) {
    const layout = court(room, request);
    return zones.map((zone) => {
      if (zone.type === 'terrace' || zone.type === 'dining') return { ...zone, rect: layout.floor };
      if (zone.type === 'destination' || zone.type === 'water') {
        return { ...zone, rect: layout.focal };
      }
      if (zone.type === 'planting') return { ...zone, rect: layout.beds[0]?.rect ?? null };
      if (zone.type === 'utility' || zone.type === 'productive') {
        return { ...zone, rect: layout.utility };
      }
      return zone;
    });
  },

  sketch(request, room, _plan, _params) {
    const s = request.scale;
    const layout = court(room, request);

    const slots: Slot[] = [terraceSlot(layout.floor, room)];

    /*
     * The focal slot on the wall opposite the doors. `axis-end` rather than `far-room`: it is a
     * thing to look at from where you are standing, not a place to walk to, and a courtyard is too
     * small to walk anywhere in.
     */
    if (layout.focal) slots.push(slotIn('axis-end', 'axis-end', layout.focal, { margin: 0.2 }));
    if (layout.utility) slots.push(slotIn('utility', 'utility', layout.utility, { turn: true }));

    /* A dining set goes on the floor itself; there is no second room to put it in. */
    const end = clampRect(
      {
        u0: layout.floor.u0,
        u1: layout.floor.u1,
        v0: layout.floor.v0,
        v1: layout.floor.v0 + (layout.floor.v1 - layout.floor.v0) / 2,
      },
      room,
    );
    if (end) slots.push(slotIn('terrace-end', 'terrace-end', end, { margin: 0.15 }));

    slots.push({
      id: 'terrace-corner',
      kind: 'terrace-corner',
      zoneId: 'terrace',
      anchor: {
        u: layout.floor.u1 - 0.8 * s,
        v: request.gateSide === 'left' ? layout.floor.v1 - 0.8 * s : layout.floor.v0 + 0.8 * s,
      },
      maxSize: { width: 1.7 * s, depth: 1.7 * s },
    });

    const beds: LayoutSketch['beds'] = layout.beds.map(({ name, rect }) => ({
      name,
      shape: {
        kind: 'rect' as const,
        rect,
        cornerRadius: request.style === 'cottage' ? 0.6 : 0,
      },
    }));

    /* One tree, in a corner, never in the middle. A courtyard with a specimen in the centre is a
     * courtyard you walk round the edge of. */
    const trees: LocalPoint[] = [{ u: room.uMax - 1.5, v: room.vMin + 1.5 }];

    return withZoneIds({
      template: 'rectilinear',
      beds,
      terrace: layout.floor,
      /* No lawn, by definition. `courtyard: true` is what tells the fill pass so. */
      lawn: null,
      lawnCategory: 'gravel-mulch',
      slots,
      paths: [],
      trees,
      axisPath: null,
      courtyard: true,
    });
  },
};

/**
 * The floor, the beds round it and the one thing worth looking at.
 *
 * The beds come first and the floor is what is left, which is the inversion that makes this a
 * composition rather than a fallback: in the other plans the terrace takes its size and the
 * planting gets the remainder, and that is how a courtyard ends up as paving with a strip round it.
 */
function court(
  room: Parameters<LayoutArchetype['zonePattern']>[1],
  request: Parameters<LayoutArchetype['zonePattern']>[3],
): {
  floor: LocalRect;
  beds: { name: string; rect: LocalRect }[];
  focal: LocalRect | null;
  utility: LocalRect | null;
} {
  const { depth, width, uMin } = extents(room);
  const s = request.scale;

  /* Deep enough to plant in layers, capped so the room keeps a floor. */
  const rearDepth = Math.min(Math.max(bed(s), depth * 0.18), depth * MAX_BED_SHARE);
  const sideDepth = Math.min(Math.max(BED_MIN_DEPTH, width * 0.12), width * MAX_BED_SHARE);

  /*
   * **Each bed is resolved by name and the floor is derived from which ones survived.**
   *
   * The first version collected them into a list and then both named them by index and sized the
   * floor by counting them. On a room too shallow for a rear border — a 7 × 2.5 m courtyard, which
   * is exactly what this composition is for — the rear bed dropped out, the two side beds shuffled
   * up, and the plan came out with a side bed labelled "Rear border" and a floor that overlapped
   * the right-hand one. Positional coupling between three independent decisions.
   */
  const rear = keep(
    clampRect({ u0: room.uMax - rearDepth, u1: room.uMax, v0: room.vMin, v1: room.vMax }, room),
    (rect) => rect.u1 - rect.u0 >= BED_MIN_DEPTH,
  );
  const floorFar = rear ? rear.u0 : room.uMax;

  const left = keep(
    clampRect({ u0: uMin, u1: floorFar, v0: room.vMin, v1: room.vMin + sideDepth }, room),
    (rect) => rect.v1 - rect.v0 >= BED_MIN_DEPTH,
  );
  const right = keep(
    clampRect({ u0: uMin, u1: floorFar, v0: room.vMax - sideDepth, v1: room.vMax }, room),
    (rect) => rect.v1 - rect.v0 >= BED_MIN_DEPTH,
  );

  const beds = [
    rear ? { name: 'Rear border', rect: rear } : null,
    left ? { name: 'Left border', rect: left } : null,
    right ? { name: 'Right border', rect: right } : null,
  ].filter((entry): entry is { name: string; rect: LocalRect } => entry !== null);

  /* The floor is what the beds leave, so it can never overlap one. */
  const floorRect = clampRect(
    {
      u0: uMin,
      u1: floorFar,
      v0: left ? left.v1 : room.vMin,
      v1: right ? right.v0 : room.vMax,
    },
    room,
  );
  /* The floor never shrinks below the terrace's own floor: a room too small to hold a table is not
   * improved by planting the space a table would have used. */
  const minimum = terraceFloor(room);
  const floor: LocalRect = floorRect ?? {
    u0: uMin,
    u1: uMin + Math.min(depth, minimum.depth),
    v0: -Math.min(width, minimum.width) / 2,
    v1: Math.min(width, minimum.width) / 2,
  };

  const focal = rear
    ? clampRect(
        {
          u0: rear.u0 - 0.2,
          u1: rear.u1,
          v0: -Math.min(1.8 * s, width * 0.25),
          v1: Math.min(1.8 * s, width * 0.25),
        },
        room,
      )
    : null;

  const utility = clampRect(
    {
      u0: uMin,
      u1: uMin + Math.min(1.6 * s, depth * 0.3),
      v0: room.vMax - Math.min(2.2 * s, width * 0.3),
      v1: room.vMax,
    },
    room,
  );

  return { floor, beds, focal, utility };
}

/** A rectangle, or nothing when it is too small to be the thing it claims to be. */
function keep(rect: LocalRect | null, viable: (rect: LocalRect) => boolean): LocalRect | null {
  return rect && viable(rect) ? rect : null;
}
