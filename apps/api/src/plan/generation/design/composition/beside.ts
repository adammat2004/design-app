import type { DesiredFeature } from '@garden-studio/schema';
import { bed } from '../../knowledge/archetypes/shared.js';
import { FEATURE_LIBRARY, placementLadder } from '../../knowledge/feature-library.js';
import {
  LAWN_FLOOR,
  terraceDepth,
  terraceFloor,
  terraceRect,
  type LocalRect,
  type SlotKind,
} from '../../layout/sketch.js';
import {
  grow,
  intersectRects,
  outlineWithout,
  rectArea,
  rectsOverlap,
  signedArea,
} from './cells.js';
import {
  BACK_GAP,
  BAY_GAP,
  COLLAR,
  CORRIDOR,
  FENCE_GAP,
  LAWN_KEEPS,
  PROTECTED,
  SERVE,
  bayOf,
  describeBay,
  planTrees,
  plantingMasses,
  seats,
  snapTo,
  wantFor,
  type ComposeInput,
  type Want,
} from './compose.js';
import type { Bay, CirculationEdge, Corridor, GardenComposition } from './types.js';

/**
 * The side-by-side garden, composed: the terrace on the doors and the lawn *beside* it along the
 * wall, where a wide shallow plot actually has its space.
 *
 * The same order as every composition — the terrace, then the open space reserved, then the rooms
 * in bays that stand round it and never on it — laid along `v` instead of `u`. The hand-drawn plan
 * put its destination "in the far corner of the lawn", which on the benchmark meant a fire pit on
 * the grass; here the far corner is a bay the lawn is notched round, reached by a path along the
 * house wall and down the fence rather than across the grass. What the hand-drawn plan got right is
 * kept: the store at the terrace's other side, held clear of the lane along the house that the way
 * in from the side gate needs.
 */

/**
 * How much of a shallow room's depth the terrace may take. More than the third the front-to-back
 * compositions allow, because the lawn is beside it rather than behind it; less than all of it,
 * because paving the whole depth of a garden makes a yard rather than a room.
 */
export const TERRACE_SHARE = 0.6;

/**
 * The lane along the house wall the way in from the side gate needs: the 1.2 m access route plus a
 * little either side, which is what it takes for a strip centred by the router to stay in the plot.
 */
export const ACCESS_LANE = 1.6;

/** The share of the plot's width the lawn's side of the terrace keeps, where the terrace can give it. */
const LAWN_SHARE = 0.4;

/** The rooms that stand in bays, in the order the bays are offered. */
const ROOM_KINDS: SlotKind[] = ['far-room', 'terrace-end', 'beside-terrace'];

export function composeBeside(input: ComposeInput): GardenComposition | null {
  const { request, room, params } = input;
  const s = request.scale;
  const D = room.uMax;
  const uMin = Math.max(room.uMin, 0);
  const depth = D - uMin;
  const b = bed(s);
  const g = request.gateSide === 'left' ? -1 : 1;
  const span = (a: number, c: number): { v0: number; v1: number } =>
    a < c ? { v0: a, v1: c } : { v0: c, v1: a };

  /* ---- 1. the terrace, deep because nothing is behind it ---- */

  const sized = terraceRect(request, room, params.terraceDepth);
  const deep = Math.max(
    0,
    Math.min(
      depth - b - 0.3,
      Math.max(terraceDepth(s, depth, params.terraceDepth), depth * TERRACE_SHARE),
    ),
  );
  let terrace: LocalRect = {
    u0: uMin,
    u1: uMin + Math.max(terraceFloor(room).depth, deep),
    v0: sized.v0,
    v1: sized.v1,
  };
  const T = terrace.u1;

  /*
   * The lawn takes the bigger gap beside the terrace and the store the other; the gate only breaks
   * a tie, because a bin can be carried a few more metres and a lawn under its floor is not a lawn.
   */
  const gapMin = terrace.v0 - room.vMin;
  const gapMax = room.vMax - terrace.v1;
  const L: 1 | -1 = Math.abs(gapMin - gapMax) < 1 ? (g < 0 ? 1 : -1) : gapMax > gapMin ? 1 : -1;
  /*
   * The terrace gives the lawn its share of the width. Sized off the house wall, on a wide house it
   * runs most of the way across and leaves the lawn a strip beside it — a patio larger than the
   * garden it opens onto, which the hierarchy principle reports. It narrows on the lawn's side, never
   * off the door and never below its own floor.
   */
  const lawnShare = LAWN_SHARE * (room.vMax - room.vMin);
  const floorWidth = Math.max(terraceFloor(room).width, request.doorWidth ?? 0);
  const doorHalf = (request.doorWidth ?? 0) / 2;
  if (L > 0 && room.vMax - terrace.v1 < lawnShare) {
    terrace = {
      ...terrace,
      v1: Math.max(room.vMax - lawnShare, doorHalf, terrace.v0 + floorWidth),
    };
  } else if (L < 0 && terrace.v0 - room.vMin < lawnShare) {
    terrace = {
      ...terrace,
      v0: Math.min(room.vMin + lawnShare, -doorHalf, terrace.v1 - floorWidth),
    };
  }
  const lawnFence = L > 0 ? room.vMax : room.vMin;
  const storeFence = L > 0 ? room.vMin : room.vMax;
  const lawnEdge = L > 0 ? terrace.v1 : terrace.v0;
  const storeEdge = L > 0 ? terrace.v0 : terrace.v1;

  /* ---- 2. what the brief needs, and the kind of place each goes ---- */

  const terraceFeature: DesiredFeature | null = request.features.includes('seating')
    ? 'seating'
    : request.features.includes('dining')
      ? 'dining'
      : null;
  const wants: Want[] = [];
  let storeTaken = false;
  const roomKinds = [...ROOM_KINDS];
  for (const feature of request.features) {
    if (feature === terraceFeature || FEATURE_LIBRARY[feature].composed) continue;
    const ladder = placementLadder(feature);
    if (feature === 'play') {
      wants.push(wantFor(feature, 'lawn-far', s));
    } else if ((ladder[0] === 'utility' || ladder[0] === 'utility-2') && !storeTaken) {
      storeTaken = true;
      wants.push(wantFor(feature, 'utility', s));
    } else {
      const kind = roomKinds.shift();
      if (kind) wants.push(wantFor(feature, kind, s));
    }
  }
  for (let spare = 0; spare < (request.extraRooms ?? 0); spare += 1) {
    const kind = roomKinds.shift();
    if (kind) wants.push(wantFor(null, kind, s));
  }
  const essentials = request.essential;
  const isEssential = (want: Want) =>
    want.feature !== null &&
    (essentials ? essentials.includes(want.feature) : wants.indexOf(want) < PROTECTED);

  /* ---- 3. the lawn, reserved beside the terrace ---- */

  const farRoomWanted = wants.some((want) => want.kind === 'far-room');
  /*
   * A path along the house wall on the lawn's side, wherever something has to be reached past the
   * lawn: a room in its far corner, or the way in from a gate in the fence at that end. Without it
   * both would have nowhere to run but across the grass.
   */
  const gateOnLawnSide = request.gateSide !== null && request.gateSide !== undefined && g === L;
  let houseLane = farRoomWanted || gateOnLawnSide;
  const fenceLane = farRoomWanted;
  const rearBed = bed(s, depth - 0.4);
  const inner = lawnEdge + L * 0.4;
  /* The lawn's outer edge: a path's width off the fence where one runs there, else a border's. */
  const outerFor = (lane: boolean) => {
    const edge = lawnFence - L * (lane ? CORRIDOR : bed(s, Math.abs(lawnFence - inner)));
    return Math.abs(edge - inner) < LAWN_FLOOR.minDimension && !lane ? lawnFence - L * 0.3 : edge;
  };
  let outer = outerFor(fenceLane);
  let lawnRect: LocalRect = {
    u0: uMin + (houseLane ? CORRIDOR : 0.4),
    u1: D - rearBed,
    ...span(inner, outer),
  };
  if (
    lawnRect.v1 - lawnRect.v0 < LAWN_FLOOR.minDimension ||
    lawnRect.u1 - lawnRect.u0 < LAWN_FLOOR.minDimension ||
    rectArea(lawnRect) < LAWN_FLOOR.area
  ) {
    return null;
  }

  /* ---- 4. the rooms, in bays that stand round the lawn ---- */

  const band: LocalRect = { u0: uMin, u1: D, v0: room.vMin, v1: room.vMax };
  const corridors: Corridor[] = [];
  const arrival = request.gate;
  if (request.gateSide && arrival && arrival.u < T) {
    const along = Math.max(uMin + SERVE, Math.min(arrival.u, T - SERVE));
    const gateFence = g > 0 ? room.vMax : room.vMin;
    const edge = g > 0 ? terrace.v1 : terrace.v0;
    corridors.push({
      name: 'arrival',
      route: 'Side path',
      rect: { u0: along - SERVE, u1: along + SERVE, ...span(edge, gateFence) },
    });
  }

  const rectFor = (want: Want): LocalRect | null => {
    switch (want.kind) {
      case 'utility': {
        /* Anchored to the far end of the terrace's depth, clear of the lane along the house. */
        const u1 = T;
        const u0 = Math.max(uMin + ACCESS_LANE, T - want.depth);
        const from = storeFence + (L > 0 ? 1 : -1) * (FENCE_GAP / 2);
        return { u0, u1, ...span(from, from + (L > 0 ? 1 : -1) * want.width) };
      }
      case 'far-room': {
        /* The lawn's far corner, against the side fence, off the grass: the lawn is notched round it. */
        const from = lawnFence - L * (FENCE_GAP / 2);
        return {
          u0: D - BACK_GAP - want.depth,
          u1: D - BACK_GAP,
          ...span(from, from - L * want.width),
        };
      }
      case 'terrace-end':
      case 'beside-terrace': {
        /* Behind the terrace, one at each end of it: off the lawn, and a stride from the doors. */
        const edge = want.kind === 'terrace-end' ? lawnEdge : storeEdge;
        const inward = want.kind === 'terrace-end' ? -L : L;
        return {
          u0: T + 0.3,
          u1: T + 0.3 + want.depth,
          ...span(edge, edge + inward * want.width),
        };
      }
      case 'lawn-far': {
        /* Play stands on the grass, on the terrace's side of it, in view and within reach. */
        const from = inner + L * 0.3;
        const mid = (lawnRect.u0 + lawnRect.u1) / 2;
        const deepest = Math.min(want.depth, lawnRect.u1 - lawnRect.u0 - 0.6);
        return {
          u0: mid - deepest / 2,
          u1: mid + deepest / 2,
          ...span(from, from + L * Math.min(want.width, Math.abs(outer - inner) - 0.6)),
        };
      }
      default:
        return null;
    }
  };

  const bays: Bay[] = [];
  const dropped: string[] = [];
  const cutOf = (rect: LocalRect) => {
    const cut = intersectRects(grow(rect, COLLAR), lawnRect);
    return cut ? snapTo(cut, lawnRect) : null;
  };
  const lawnWith = (extra: LocalRect[]) =>
    outlineWithout(lawnRect, [
      ...[...bays.filter((bay) => bay.feature !== 'play').map((bay) => bay.rect), ...extra]
        .map(cutOf)
        .filter((cut): cut is LocalRect => cut !== null),
      ...corridors
        .map((corridor) => intersectRects(corridor.rect, lawnRect))
        .filter((cut): cut is LocalRect => cut !== null),
    ]);

  /* Stores first, then the rooms, then play: the lane and the path were planned round the store. */
  const order = [...wants].sort(
    (a, c) => rank(a.kind) - rank(c.kind) || wants.indexOf(a) - wants.indexOf(c),
  );
  /*
   * Once the rooms are settled, a lawn narrowed for a path to its far corner takes the width back
   * if nothing went there after all — a room too wide for the corner goes behind the terrace, and a
   * path's width of lawn given up for a path never drawn is the leftover this layer exists to stop.
   * Before play, which stands on the lawn's final shape.
   */
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (!fenceLane || bays.some((bay) => bay.kind === 'far-room')) return;
    houseLane = gateOnLawnSide;
    outer = outerFor(false);
    lawnRect = { ...lawnRect, u0: uMin + (houseLane ? CORRIDOR : 0.4), ...span(inner, outer) };
  };
  for (const want of order) {
    if (want.kind === 'lawn-far') settle();
    const options: Want[] = [want];
    /* A far room turned, long side to the fence, where square-on it is wider than the gap. */
    if (want.kind === 'far-room') options.push({ ...want, width: want.depth, depth: want.width });
    if (ROOM_KINDS.includes(want.kind) && want.feature) {
      for (const kind of ROOM_KINDS) {
        if (kind !== want.kind && !bays.some((bay) => bay.kind === kind)) {
          options.push(wantFor(want.feature, kind, s));
        }
      }
    }
    const chosen = options
      .map((option) => ({ option, rect: rectFor(option) }))
      .map(({ option, rect }) => ({ option, rect: rect ? intersectRects(rect, band) : null }))
      .find(({ option, rect }) => {
        if (!rect || !seats(option, rect)) return false;
        if (option.kind !== 'lawn-far' && rectsOverlap(rect, terrace, -1e-9)) return false;
        if (bays.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) return false;
        if (corridors.some((corridor) => rectsOverlap(corridor.rect, rect, -1e-9))) return false;
        if (option.kind === 'lawn-far') return true;
        const outline = lawnWith([rect]);
        if (!outline) return false;
        const area = Math.abs(signedArea(outline));
        return area >= (isEssential(want) ? LAWN_FLOOR.area : LAWN_KEEPS * rectArea(lawnRect));
      });
    if (!chosen?.rect) {
      if (isEssential(want)) return null;
      dropped.push(want.feature ?? 'a second seating area');
      continue;
    }
    bays.push(bayOf(chosen.option, chosen.rect));
  }
  settle();

  /* ---- 5. the paths ---- */

  const circulation: CirculationEdge[] = [];
  const farRoom = bays.find((bay) => bay.kind === 'far-room');
  if (farRoom) {
    const vc = lawnFence - L * SERVE;
    const turnU = farRoom.rect.u0 - SERVE;
    corridors.push(
      {
        name: 'house lane',
        route: 'Garden path',
        rect: { u0: uMin, u1: uMin + CORRIDOR, ...span(lawnEdge, lawnFence) },
      },
      {
        name: 'fence corridor',
        route: 'Garden path',
        rect: { u0: uMin, u1: farRoom.rect.u0, ...span(lawnFence, lawnFence - L * CORRIDOR) },
      },
    );
    circulation.push({
      name: 'Garden path',
      from: { u: uMin + SERVE, v: lawnEdge },
      to: { slot: farRoom.id },
      via: [
        { u: uMin + SERVE, v: vc },
        { u: turnU, v: vc },
      ],
      tier: 'secondary',
      purpose: 'garden-route',
    });
  } else if (houseLane) {
    corridors.push({
      name: 'house lane',
      rect: { u0: uMin, u1: uMin + CORRIDOR, ...span(lawnEdge, lawnFence) },
    });
  }
  /*
   * The store stands against the fence, out of the view, and beside the terrace rather than behind
   * it — so where there is more than a stride of planting between them, a short path runs across to
   * it from the terrace's end. Straight rather than round: the bins come this way every week.
   */
  const store = bays.find((bay) => bay.kind === 'utility');
  if (store && gapTo(store.rect, terrace) > NO_PATH_NEEDED) {
    const along = (Math.max(store.rect.u0, terrace.u0) + Math.min(store.rect.u1, terrace.u1)) / 2;
    const face = L > 0 ? store.rect.v1 : store.rect.v0;
    corridors.push({
      name: 'store spur',
      route: 'Path to the shed',
      rect: { u0: along - SERVE, u1: along + SERVE, ...span(storeEdge, face) },
    });
    circulation.push({
      name: 'Path to the shed',
      from: { u: along, v: storeEdge },
      to: { slot: store.id },
      via: [],
      tier: 'primary',
      purpose: 'utility-route',
    });
  }

  if (request.gateSide) {
    circulation.push({
      name: 'Side path',
      from: { u: 0, v: g * (room.vMax - room.vMin) },
      to: { gate: true },
      via: [],
      tier: 'primary',
      purpose: 'access-route',
    });
  }

  /* ---- 6. the lawn, notched only where a room or a path reaches into it ---- */

  const outline = lawnWith([]);
  if (!outline || Math.abs(signedArea(outline)) < LAWN_FLOOR.area) return null;

  /* ---- 7. what terminates the view, the planting, the trees ---- */

  const axisEnd = request.view?.axisEnd ?? { u: D, v: 0 };
  const onAxis = bays.find(
    (bay) =>
      bay.rect.u0 >= T &&
      bay.feature !== 'play' &&
      bay.rect.v0 - 0.5 <= axisEnd.v &&
      bay.rect.v1 + 0.5 >= axisEnd.v,
  );
  if (onAxis) onAxis.purpose = 'focal';

  const masses = plantingMasses({
    room,
    terrace,
    lawn: lawnRect,
    lawnOutline: outline,
    wedges: [],
    bays,
    near: [],
    corridors,
    axis: null,
    gateFence: g > 0 ? room.vMax : room.vMin,
    g,
    formal: false,
    enclosing: false,
    sequence: false,
    beside: L,
  });

  const trees = planTrees({
    D,
    lawn: lawnRect,
    bays,
    masses,
    focal: onAxis ? null : axisEnd,
    g,
    rearSpan: [room.vMin, room.vMax],
    scale: s,
    glimpse: null,
  });

  const decisions: GardenComposition['decisions'] = [
    {
      kind: 'beside',
      text: 'Laid the terrace and the lawn side by side across the garden, where a wide shallow plot has its room, rather than one behind the other.',
    },
  ];
  if (farRoom) {
    decisions.push({
      kind: 'circulation',
      text: `Put the ${describeBay(farRoom)} in the lawn's far corner, reached along the house and down the fence rather than across the grass.`,
    });
  }
  if (onAxis) {
    decisions.push({
      kind: 'focal',
      text: `Put the ${describeBay(onAxis)} at the end of the view from the doors, so the eye has somewhere to land.`,
    });
  }
  if (dropped.length > 0) {
    decisions.push({
      kind: 'no-room',
      text: `There was no bay for ${dropped.join(', ')} that did not mean standing it on the lawn.`,
    });
  }

  return {
    archetype: input.archetype,
    language: input.language,
    terrace,
    openSpace: {
      rect: lawnRect,
      shape: { kind: 'polygon', points: outline, styleCorners: true },
      category: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
    },
    bays,
    corridors,
    circulation,
    focal: onAxis
      ? { kind: 'feature', bay: onAxis.id }
      : trees.some((tree) => tree.role === 'focal')
        ? { kind: 'tree', at: trees.find((tree) => tree.role === 'focal')!.at }
        : null,
    masses,
    trees,
    axis: null,
    axisStops: [],
    decisions,
  };
}

/**
 * The scorer's `NO_PATH_NEEDED`: a room this close to the terrace is reached from it directly. A
 * path shorter than this would also be refused by the router as too short to read as one.
 */
const NO_PATH_NEEDED = 2.5;

function gapTo(a: LocalRect, b: LocalRect): number {
  return Math.hypot(Math.max(0, a.u0 - b.u1, b.u0 - a.u1), Math.max(0, a.v0 - b.v1, b.v0 - a.v1));
}

function rank(kind: SlotKind): number {
  return kind === 'utility' ? 0 : kind === 'lawn-far' ? 2 : 1;
}
