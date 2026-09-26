import type { DesiredFeature, LayoutArchetypeId } from '@garden-studio/schema';
import { FEATURE_SPECS } from '../../archetypes.js';
import { FEATURE_LIBRARY, placementLadder } from '../../knowledge/feature-library.js';
import {
  BED_MIN_DEPTH,
  LAWN_FLOOR,
  MOWING_STRIP,
  borderIn,
  clamp,
  clampToRoom,
  isCourtyard,
  lawnEnd,
  lawnStart,
  roomBehind,
  terraceDepth,
  PERGOLA_FLOOR,
  terraceFloor,
  terraceRect,
  terraceWidth,
  type LocalPoint,
  type LocalRect,
  type Room,
  type SketchRequest,
  type Slot,
  type SlotKind,
} from '../../layout/sketch.js';
import { floorScale, sizeToSlot, type Footprint } from '../../layout/fit.js';
import { SHALLOW_LAWN } from '../../knowledge/archetypes/shared.js';
import type { CandidateParams } from '../types.js';
import {
  cellCentre,
  gridOver,
  grow,
  inRect,
  intersectRects,
  loopsOf,
  outlineWithout,
  rectArea,
  rectsOverlap,
  signedArea,
} from './cells.js';
import type {
  Bay,
  CirculationEdge,
  Corridor,
  ElementPurpose,
  GardenComposition,
  GeometryLanguage,
  OpenSpace,
  PlantingMass,
  TreePlan,
} from './types.js';

/**
 * A garden composed in the order a designer draws one.
 *
 * ```
 *   1. the terrace across the doors            (the one room every garden has)
 *   2. which rooms the brief needs, and where   (each into a bay, by the feature's own ladder)
 *   3. the open space                           (reserved: a panel the rooms stand round, not on)
 *   4. the corridors                            (a strip at the fence for every side that needs one)
 *   5. the bays                                 (rooms in the far corners, or on the axis)
 *   6. the circulation and the lawn's shape     (a path down each side, a walk down the view, and
 *                                                the lawn notched only where a room reaches into it)
 *   8. what terminates the view                 (a room on the axis, or a tree placed for it)
 *   9. the planting, named for what it does     (what the lawn, bays and corridors leave)
 *  10. the trees, each for a reason             (focal, framing, screening, then backdrop)
 * ```
 *
 * The rule the whole file rests on: **a room is never placed on the open ground.** It goes in a bay
 * carved out of the border or a corner, and where a bay has to reach into the panel the panel is
 * notched round it with a collar of planting — never left underneath it. The one exception is a play
 * area, which belongs on the grass by the relationship rules' own reasoning.
 *
 * `null` means this plot is a courtyard — no viable lawn behind the terrace — and the caller keeps
 * the hand-drawn composition for it, which already knows how to pave a small room.
 */

/**
 * How far a route's centreline runs from the face of what it serves.
 *
 * Under the 0.6 m the circulation principle counts as "served", and over half the widest route a
 * composed plan lays (1.05 m, the utility path), so a route running past a room's face touches
 * nothing and still reaches it. Every corridor is twice this wide.
 */
export const SERVE = 0.58;

/** A corridor: a route's centreline with `SERVE` either side. */
export const CORRIDOR = 2 * SERVE;

/** The store stands this far off the fence: enough to get round the back of it with a brush. */
export const FENCE_GAP = 0.6;

/** A destination at the far end keeps this much planting behind it, and never less than the minimum. */
export const BACK_GAP = 0.9;
export const BACK_GAP_MIN = 0.4;

/**
 * The clearance left round a bay wherever it reaches into the lawn: a hairline, so the room meets
 * the grass the way a terrace does in the reference plan.
 *
 * It was a 0.4 m ring of planting. A bed that thin is under the sliver guard, so the fill pass
 * dropped it and the plan showed a strip of bare ground between every room and the lawn.
 */
export const COLLAR = 0.1;

/** Clear ground round a feature inside its bay, so the bay reads as a room rather than a box. */
export const BAY_MARGIN = 0.25;

/** Two bays side by side keep at least this between them, for planting. */
export const BAY_GAP = 0.4;

/** The formal plan's paved line down the middle. A path two people can walk abreast. */
const AXIS_WIDTH = 1.2;

/**
 * The lawn keeps at least this share of its rectangle after every notch. Past it, the room that
 * would take more is refused rather than the lawn made smaller: the open space is the thing the
 * rooms stand round, and a garden whose lawn is the leftover of its rooms is the fault this layer
 * exists to prevent.
 */
export const LAWN_KEEPS = 0.6;

/**
 * Where the brief does not say which rooms are essential, the first this many in priority order are
 * treated as the ones the lawn gives way to.
 */
export const PROTECTED = 2;

/**
 * A screening bed where the brief asks for one on a side that would otherwise be a mowing edge: a
 * bed a shrub can stand in, over the 1.2 m the privacy principle counts as a screen and the sliver
 * guard counts as a bed.
 */
const SCREEN_BED = BED_MIN_DEPTH + 0.3;

/** Trees along a border are spaced at this, times the plot's scale. */
const TREE_SPACING = 5;

/** Which slot kinds each language can host a room in. */
const HOSTS: Record<GeometryLanguage, SlotKind[]> = {
  rectilinear: [
    'terrace-end',
    'beside-terrace',
    'terrace-corner',
    'far-room',
    'lawn-far',
    'utility',
    'utility-2',
  ],
  soft_organic: [
    'terrace-end',
    'beside-terrace',
    'terrace-corner',
    'far-room',
    'lawn-far',
    'utility',
    'utility-2',
  ],
  formal_symmetric: [
    'terrace-end',
    'beside-terrace',
    'axis-end',
    'lawn-far',
    'utility',
    'utility-2',
  ],
};

/** Where a spare room goes, best first. */
const SPARE: Record<GeometryLanguage, SlotKind[]> = {
  rectilinear: ['far-room', 'terrace-corner'],
  soft_organic: ['far-room', 'terrace-corner'],
  formal_symmetric: ['axis-end'],
};

/** Why a thing in each kind of bay is there. */
const PURPOSE_BY_KIND: Record<SlotKind, ElementPurpose> = {
  terrace: 'terrace',
  'terrace-end': 'dining-room',
  'beside-terrace': 'dining-room',
  'terrace-corner': 'lounge',
  'far-room': 'destination',
  'lawn-far': 'play',
  utility: 'utility-store',
  'utility-2': 'productive',
  'axis-end': 'focal',
};

export { PURPOSE_BY_KIND };

/** The bays that stand at the far end, one of which may terminate the view. */
const REAR: SlotKind[] = ['far-room', 'utility', 'utility-2', 'axis-end', 'lawn-far'];

/**
 * What can be the reason to walk to the far end of a destination garden, best first.
 *
 * A place to sit round a fire, a room, somewhere to soak, water: each is somewhere you go. Dining is
 * last because a table usually wants to be near the kitchen — it is the destination only where the
 * brief offers nothing better. Seating is absent because it is the terrace; a *second* seat is the
 * spare room, and is the destination only where the plot is already carrying one.
 */
const DESTINATIONS: DesiredFeature[] = ['firePit', 'gardenRoom', 'hotTub', 'water', 'dining'];

/**
 * The planted screen between the lawn and the room at the end of a destination garden. The eye is
 * stopped here and the walk goes round it, which is what makes the far end a place rather than the
 * back of the lawn — and it is never under the sliver guard, or the fill pass drops it.
 */
function screenDepth(s: number): number {
  return Math.max(BED_MIN_DEPTH, 1.6 * Math.sqrt(s));
}

/**
 * The most of the garden beyond the terrace a destination garden's far room may take, from the
 * hand-drawn plan's own clamp. Sized from the feature alone, a fire pit on a big plot is a six-metre
 * circle of gravel, and the lawn the walk runs beside is left three metres deep with a play area on
 * all of it — a garden that is mostly its far end, which is the reverse of the point.
 */
const DESTINATION_SHARE = 0.32;

/**
 * A want scaled down, whole, to take at most `depth` of the garden — never below the feature's
 * own floor. Scaled uniformly because the fitter scales uniformly: a bay trimmed on one side only
 * leaves a strip of it nothing will stand on.
 */
function withinShare(want: Want, depth: number): Want {
  if (want.depth <= depth) return want;
  const k = depth / want.depth;
  const scaled = { ...want, width: want.width * k, depth };
  return seats(scaled, { u0: 0, u1: scaled.depth, v0: 0, v1: scaled.width }) ? scaled : want;
}

export interface ComposeInput {
  archetype: LayoutArchetypeId;
  language: GeometryLanguage;
  request: SketchRequest;
  room: Room;
  params: CandidateParams;
}

export interface Want {
  feature: DesiredFeature | null;
  kind: SlotKind;
  /** The feature's own footprint at this plot's scale, before any bay margin. */
  footprint: Footprint;
  /** Along `v` (the wall) and along `u` (out from it), margin included. */
  width: number;
  depth: number;
  minSize?: { width: number; depth: number };
}

export function composeGarden(input: ComposeInput): GardenComposition | null {
  const { request, room, params, language } = input;
  const s = request.scale;
  const D = room.uMax;
  const formal = language === 'formal_symmetric';

  /* ---- 1. the terrace ---- */

  let terrace = formal
    ? formalTerrace(request, room, params)
    : terraceRect(request, room, params.terraceDepth);
  const T = terrace.u1;
  if (isCourtyard(s, D, room.vMax - room.vMin, params.terraceDepth)) return null;

  const decisions: GardenComposition['decisions'] = [];

  /* The part of the room behind the terrace: on an L-plot, the deep limb alone. */
  const deep = roomBehind(room, T + 0.4);
  let vLo = deep.vMin;
  let vHi = deep.vMax;
  if (formal) {
    const dw = Math.max(0.5, Math.min(-deep.vMin, deep.vMax));
    vLo = -dw;
    vHi = dw;
  }
  const g = request.gateSide === 'left' ? -1 : 1;
  const gateFence = g > 0 ? vHi : vLo;
  const awayFence = g > 0 ? vLo : vHi;
  /** `metres` in from the gate-side fence. */
  const gIn = (metres: number) => gateFence - g * metres;
  /** `metres` in from the other fence. */
  const aIn = (metres: number) => awayFence + g * metres;
  const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

  /* ---- 2. the rooms the brief needs, each to the first bay on its own ladder ---- */

  const terraceFeature: DesiredFeature | null = request.features.includes('seating')
    ? 'seating'
    : request.features.includes('dining')
      ? 'dining'
      : null;
  const hosts = HOSTS[language];
  const wants: Want[] = [];
  const taken = new Set<SlotKind>();

  /*
   * A destination garden is organised round the room at the far end, so that room is decided
   * first and pinned there, whatever its own ladder says. It has to be a room the realisation will
   * actually fill: one of the features that can be the reason to walk, or — where the plot is
   * already carrying a second seat — that seat. With neither there is nothing to walk to, and the
   * composition declines to the hand-drawn plan rather than draw a destination that is an empty bay.
   */
  /*
   * A sequence of rooms is the same composition read along a long narrow plot: the terrace, a lawn
   * entered through an opening in the planting, a planted divider, and a room at the far end. What
   * differs is what may be the far room — anything that belongs at the far end, not only a reason to
   * walk there — and that the dividers are the point of it rather than a preference the lawn can
   * outvote. Its path runs down the side of the rooms and through the gaps; the swing across each
   * room the hand-drawn plan drew was a path across the lawn, which is what composing refuses.
   */
  const sequence = input.archetype === 'linear_sequence';
  const walkTo = input.archetype === 'destination_garden' || sequence;
  let destination: Want | null = null;
  let sparesUsed = 0;
  if (walkTo) {
    const feature =
      DESTINATIONS.find(
        (candidate) => candidate !== terraceFeature && request.features.includes(candidate),
      ) ??
      (sequence
        ? request.features.find(
            (candidate) =>
              candidate !== terraceFeature &&
              candidate !== 'play' &&
              !FEATURE_LIBRARY[candidate].composed &&
              placementLadder(candidate).includes('far-room'),
          )
        : undefined);
    if (feature) destination = wantFor(feature, 'far-room', s);
    else if ((request.extraRooms ?? 0) > 0) {
      destination = wantFor(null, 'far-room', s);
      sparesUsed = 1;
    } else return null;
    destination = withinShare(destination, DESTINATION_SHARE * (D - T));
    taken.add('far-room');
    wants.push(destination);
  }

  for (const feature of request.features) {
    if (feature === terraceFeature || FEATURE_LIBRARY[feature].composed) continue;
    if (feature === destination?.feature) continue;
    const kind = placementLadder(feature).find((k) => hosts.includes(k) && !taken.has(k));
    if (!kind) continue;
    taken.add(kind);
    wants.push(wantFor(feature, kind, s));
  }
  for (let spare = sparesUsed; spare < (request.extraRooms ?? 0); spare += 1) {
    const kind = SPARE[language].find((k) => !taken.has(k));
    if (!kind) break;
    taken.add(kind);
    wants.push(wantFor(null, kind, s));
  }

  /*
   * Room beside the terrace for the rooms that belong there. The terrace is sized off the house
   * wall, so on a plot barely wider than the house it runs from fence to fence and a dining area or
   * a kitchen asked for beside it has nowhere to go — the old answer was the sampler, which put the
   * table on the lawn. A designer narrows the terrace instead, and puts the dining at its end: the
   * terrace gives up width down to its own floor, never off the door.
   */
  const doorHalf = (request.doorWidth ?? 0) / 2;
  const floorWidth = Math.max(terraceFloor(room).width, 2 * doorHalf);
  const make = (kind: SlotKind, side: 'min' | 'max', need: number) => {
    if (!wants.some((want) => want.kind === kind)) return;
    const free = side === 'min' ? terrace.v0 - room.vMin : room.vMax - terrace.v1;
    const give = Math.min(need - free, terrace.v1 - terrace.v0 - floorWidth);
    if (give <= 0) return;
    terrace =
      side === 'min'
        ? { ...terrace, v0: Math.min(terrace.v0 + give, -doorHalf) }
        : { ...terrace, v1: Math.max(terrace.v1 - give, doorHalf) };
  };
  const endSide = formal || g > 0 ? 'min' : 'max';
  make('terrace-end', endSide, PERGOLA_FLOOR.width + 0.3);
  make('beside-terrace', endSide === 'min' ? 'max' : 'min', 1.5 * s + 0.3);

  const wanted = (kind: SlotKind) => wants.find((want) => want.kind === kind) ?? null;
  const play = wants.find((want) => want.kind === 'lawn-far' && want.feature === 'play') ?? null;
  /*
   * Which side of the garden each far room is reached from. The store and the working bay are on
   * the gate side, because that is the way the bins and the mower come in. A destination on the
   * diagonal is on the other side, reached down its own path. A room centred on the far end — and a
   * play area, which stands on the grass — is reached down the axis from the doors: the one path a
   * designer does run across a lawn, because the thing at the end of it is the reason to walk it.
   */
  const farRoom = wanted('far-room');
  /*
   * A destination on the diagonal needs its own path down the far side, and that costs the lawn a
   * corridor's width. Where the garden is too narrow to give it — a lawn at its floor, a corridor
   * each side and the thinnest bed — the destination goes on the axis instead, reached down the
   * view: the right answer for a long narrow garden anyway, whose point is the far end.
   */
  const roomWidth = vHi - vLo;
  /** Wide enough for a path down each side as well as a lawn at its floor and a bed. */
  const twoPaths = roomWidth >= LAWN_FLOOR.minDimension + 2 * CORRIDOR + BED_MIN_DEPTH + 0.5;
  /* Never in a sequence: the dividers run across the garden to a room across its far end. */
  const diagonal =
    !formal && !sequence && farRoom !== null && params.destination === 'far-diagonal' && twoPaths;
  const gateRooms = wants.filter((want) => want.kind === 'utility' || want.kind === 'utility-2');
  /*
   * On a garden too narrow for two paths, a destination is reached by the one path there is: the
   * path to the store runs past its side on the way. A second path down the other side took the
   * last of the width from the planting and left the lawn at its floor between two strips of
   * paving — a corridor rather than a garden.
   */
  const shareGate = destination !== null && !diagonal && gateRooms.length > 0 && !twoPaths;

  /* ---- 3 & 4. the open space, with its corridors kept clear ---- */

  /*
   * A sequence's lawn is entered through a planted threshold, so it starts a bed's depth off the
   * terrace — the first divider, with an opening in front of the doors. A bed *behind* a corridor's
   * width: a path that leaves the terrace sideways runs along its garden edge first, and a band only a
   * bed deep was cut by those step-outs into scraps under the sliver guard.
   */
  const start = sequence
    ? Math.max(lawnStart(s, D, T), T + CORRIDOR + BED_MIN_DEPTH + 0.1)
    : lawnStart(s, D, T);
  /*
   * In a destination garden the lawn stops short of the far end: the room there stands behind a
   * planted screen, with the path turning along its front. Where the screen would leave the lawn a
   * strip — under `SHALLOW_LAWN`, the rule the archetypes already judge a lawn by — the path runs
   * along the lawn's end instead: the lawn wins over the screen, as it wins over a border. Where even
   * that leaves no lawn the composition declines.
   */
  const screen = screenDepth(s);
  const lawnBefore = (front: number) => {
    const screened = front - CORRIDOR - screen;
    /* In a sequence the divider is the composition, so it gives way only to the lawn's floor. */
    return screened - start >= (sequence ? LAWN_FLOOR.minDimension : SHALLOW_LAWN)
      ? screened
      : front - CORRIDOR;
  };
  const end = destination
    ? Math.min(lawnEnd(s, D, T), lawnBefore(D - BACK_GAP - destination.depth))
    : lawnEnd(s, D, T);
  const width = vHi - vLo;
  const b = borderIn(s, width - MOWING_STRIP, end - start);

  const deepOnGate = !formal && params.lawnBias === 'away';
  const even = formal || params.lawnBias === 'centre';
  /*
   * A corridor runs along a fence wherever something at the far end on that side needs reaching.
   * In a rectilinear or soft plan it runs at the fence itself — the side path — with the border
   * between it and the lawn on the deep side and the lawn running to its edge on the other. In a
   * formal plan the corridors are a symmetric pair between the borders and the lawn: a perimeter
   * walk, and only where a store at one of the far corners needs one.
   */
  const gateCorridor = gateRooms.length > 0;
  /* A destination garden's walk runs down the away side and turns in along the room's front. */
  const awayCorridor = diagonal || (destination !== null && !shareGate);
  /*
   * Planting as deep as its job. A brief that asks to screen the neighbours or to feel enclosed
   * gets a screen against a side fence that would otherwise be a mowing edge — deep enough to
   * screen a seat, `SCREEN_BED`, and no deeper — with any path run inside it, beside the lawn. The
   * deep side stays deep. **And only where the boundary is too low to screen on its own**
   * (`lowSides`): a 1.8 m fence already is the screen.
   *
   * Both limits were measured. A full border on both sides cost every such lawn two metres; most
   * briefs ask to screen their neighbours, and plans inside the composition bands fell from 68% to
   * 59%. A screening bed against every side fence still took them to 62%, with the privacy
   * principle at 1.000 on every plan either way — the fences were already doing it. Switched off,
   * 73%. Planting that screens nothing is width the lawn needed.
   */
  const asked =
    !formal && (request.privacy === 'screen-neighbours' || request.privacy === 'enclose');
  const low = (side: 'gate' | 'away') =>
    (request.lowSides ?? []).includes((side === 'gate') === g > 0 ? 'right' : 'left');
  /** Screened on this side: the brief asked, and the boundary there is too low to do it alone. */
  const screens = (side: 'gate' | 'away') => asked && low(side);
  const sideScreen = Math.min(b, SCREEN_BED);
  const gateBorder =
    even || deepOnGate ? b : screens('gate') ? sideScreen : gateCorridor ? 0 : MOWING_STRIP;
  const awayBorder =
    even || !deepOnGate ? b : screens('away') ? sideScreen : awayCorridor ? 0 : MOWING_STRIP;

  let gateInset = (gateCorridor ? CORRIDOR : 0) + gateBorder;
  let awayInset = (awayCorridor ? CORRIDOR : 0) + awayBorder;
  if (formal && gateCorridor) {
    /* Both sides alike, whichever side the store turned out to be on: that is what formal means. */
    gateInset = CORRIDOR + b;
    awayInset = CORRIDOR + b;
  }
  /*
   * The lawn's floor wins over the borders' depth — the rule `borderIn` already states, applied to
   * whatever the corridors left. The deep border gives way first, and never below a mowing edge.
   */
  const shortfall = LAWN_FLOOR.minDimension - (width - gateInset - awayInset);
  if (shortfall > 0 && formal) {
    /* A formal plan gives the same from both sides, or it stops being symmetric. */
    const each = Math.min(shortfall / 2, Math.max(0, b - MOWING_STRIP));
    awayInset -= each;
    gateInset -= each;
  } else if (shortfall > 0) {
    const giveAway = Math.min(shortfall, Math.max(0, awayBorder - MOWING_STRIP));
    awayInset -= giveAway;
    gateInset -= Math.min(shortfall - giveAway, Math.max(0, gateBorder - MOWING_STRIP));
  }

  const lawnV = span(gIn(gateInset), aIn(awayInset));
  if (lawnV[1] - lawnV[0] < LAWN_FLOOR.minDimension) return null;

  /*
   * Where each side's corridor runs: at the fence, or between the border and the lawn — formal, and
   * the walk to a destination centred at the far end. That walk runs *beside the lawn*, because it
   * turns in to the middle of the garden at the end: down the fence behind the border it measured
   * 2.4 times the direct line, a detour the planting hides rather than a walk you take. To a
   * destination in the far corner it stays at the fence, where it runs straight into the room.
   */
  const inboard = (side: 'gate' | 'away') =>
    formal || screens(side) || (side === 'away' && destination !== null && !diagonal);
  const corridorAt = (side: 'gate' | 'away') =>
    inboard(side)
      ? side === 'gate'
        ? gIn(gateInset - SERVE)
        : aIn(awayInset - SERVE)
      : side === 'gate'
        ? gIn(SERVE)
        : aIn(SERVE);
  const leaves = (v: number) => clamp(v, terrace.v0 + 0.6, terrace.v1 - 0.6);
  const sidewaysGate =
    gateCorridor && Math.abs(leaves(corridorAt('gate')) - corridorAt('gate')) > 1e-6;
  const sidewaysAway =
    awayCorridor && Math.abs(leaves(corridorAt('away')) - corridorAt('away')) > 1e-6;
  const formalBoth = formal && gateCorridor;

  /*
   * A route that leaves the terrace sideways, to reach a corridor at the fence, runs along the
   * terrace's garden edge first — a step-out — and the lawn's near corner on that side is notched
   * for it. The first version pushed the whole lawn a corridor's width further out instead, which
   * left a bare strip across the garden and, on a small plot, pushed the lawn under its floor.
   */
  const u0 = start;
  void sidewaysGate;
  void sidewaysAway;
  void formalBoth;
  if (end - u0 < LAWN_FLOOR.minDimension) return null;

  /* ---- 5. the rooms, in bays at the corners and down the axis ---- */

  const bays: Bay[] = [];
  const dropped: string[] = [];
  const band: LocalRect = { u0: Math.max(room.uMin, 0), u1: D, v0: room.vMin, v1: room.vMax };
  const near = nearBays(request, terrace, s, formal, g, band);

  const rectFor = (want: Want): LocalRect | null => {
    switch (want.kind) {
      case 'utility': {
        const from = gateCorridor ? FENCE_GAP / 2 : FENCE_GAP;
        return {
          u0: D - FENCE_GAP - want.depth,
          u1: D - FENCE_GAP,
          ...vRange(span(gIn(from), gIn(from + want.width))),
        };
      }
      case 'utility-2': {
        if (formal) {
          return {
            u0: D - FENCE_GAP - want.depth,
            u1: D - FENCE_GAP,
            ...vRange(span(aIn(FENCE_GAP / 2), aIn(FENCE_GAP / 2 + want.width))),
          };
        }
        const store = bays.find((bay) => bay.kind === 'utility');
        const from = store
          ? Math.abs(gateFence - (g > 0 ? store.rect.v0 : store.rect.v1)) + BAY_GAP
          : FENCE_GAP / 2;
        const u0Row = store ? store.rect.u0 : D - FENCE_GAP - want.depth;
        return {
          u0: u0Row,
          u1: Math.min(D - BACK_GAP_MIN, u0Row + want.depth),
          ...vRange(span(gIn(from), gIn(from + want.width))),
        };
      }
      case 'far-room':
        if (diagonal) {
          return {
            u0: D - BACK_GAP - want.depth,
            u1: D - BACK_GAP,
            ...vRange(span(aIn(FENCE_GAP / 2), aIn(FENCE_GAP / 2 + want.width))),
          };
        }
        if (gateCorridor) {
          /*
           * The path to the store runs down the gate side past the far end, so a room there leaves
           * it clear: on a narrow plot a centred room otherwise stands across the only way to the
           * shed, and the store is reached by nothing. Any far room, not only a destination's — the
           * terrace-and-lawn plan on the long narrow plot lost its store's path exactly this way
           * once the placement budget stopped cutting the store.
           */
          const limit = gIn(CORRIDOR);
          const [v0, v1] = [-want.width / 2, want.width / 2];
          return {
            u0: D - BACK_GAP - want.depth,
            u1: D - BACK_GAP,
            v0: g > 0 ? v0 : Math.max(v0, limit),
            v1: g > 0 ? Math.min(v1, limit) : v1,
          };
        }
        return {
          u0: D - BACK_GAP - want.depth,
          u1: D - BACK_GAP,
          v0: -want.width / 2,
          v1: want.width / 2,
        };
      case 'lawn-far':
      case 'axis-end':
        return {
          u0: D - BACK_GAP - want.depth,
          u1: D - BACK_GAP,
          v0: -want.width / 2,
          v1: want.width / 2,
        };
      case 'terrace-corner': {
        const from = awayCorridor ? CORRIDOR + FENCE_GAP / 2 : BAY_GAP;
        return { u0, u1: u0 + want.depth, ...vRange(span(aIn(from), aIn(from + want.width))) };
      }
      case 'terrace-end': {
        /*
         * At the end of the terrace along the wall if there is room; otherwise stepped down off
         * its front corner — an L-shaped terrace, with the lawn notched round the step. Where the
         * door fixes the terrace's position and the plot is barely wider than the house, that is
         * the only place a table beside the terrace can go.
         */
        const side = near['terrace-end'];
        if (side && seats(want, side)) return side;
        const fence = endSide === 'min' ? room.vMin : room.vMax;
        const inward = endSide === 'min' ? 1 : -1;
        return {
          u0: T,
          u1: T + want.depth,
          ...vRange(
            span(fence + (inward * FENCE_GAP) / 2, fence + inward * (FENCE_GAP / 2 + want.width)),
          ),
        };
      }
      default:
        return near[want.kind] ?? null;
    }
  };

  /** A bay for this want, or `null`: its own place, then — at the far end — stacked in front of what is there. */
  const place = (want: Want): LocalRect | null => {
    const raw = rectFor(want);
    let rect = raw ? intersectRects(raw, band) : null;
    const clashing = (candidate: LocalRect) =>
      bays.filter(
        (bay) =>
          !isNear(want.kind) &&
          !isNear(bay.kind) &&
          rectsOverlap(bay.rect, candidate, BAY_GAP - 1e-9),
      );
    if (rect && REAR.includes(want.kind) && clashing(rect).length > 0) {
      /* The far end is taken on this side: stand in front of whatever took it. */
      const front = Math.min(...clashing(rect).map((bay) => bay.rect.u0)) - BAY_GAP;
      rect = { ...rect, u0: front - (rect.u1 - rect.u0), u1: front };
    }
    const ok =
      rect !== null &&
      clashing(rect).length === 0 &&
      !rectsOverlap(rect, terrace, -1e-9) &&
      seats(want, rect);
    return ok ? rect : null;
  };

  /*
   * Placed in priority order. A room whose first bay is refused tries the rest of its own ladder
   * before it is reported as not included — but only the rungs that change no corridor, because
   * the corridors were laid out on the strength of which far rooms there would be.
   */
  /*
   * Where a room may go, best first: the rungs of its own ladder, then — for anything but a store,
   * which changes the corridors — the far end on the axis, then a bay set into either side border
   * at the lawn's middle, the way a seat or a pool is tucked into a planted edge. The first place
   * that seats the feature, clashes with nothing and still leaves the lawn a lawn is the one taken.
   *
   * Checked against the lawn as each room is placed rather than refused afterwards: a room that
   * would cost the lawn too much in its first place is offered its next, which is what a designer
   * does and what the sampler used to do by standing it on the grass instead.
   */
  const provisionalLawn: LocalRect = { u0, u1: end, v0: lawnV[0], v1: lawnV[1] };
  const essentials = request.essential;
  const isEssential = (want: Want, index: number) =>
    essentials ? want.feature !== null && essentials.includes(want.feature) : index < PROTECTED;
  const lawnKeeps = (candidate: LocalRect, essential: boolean) => {
    if (formal) return true;
    const cuts = [...bays.filter((bay) => bay.feature !== 'play').map((bay) => bay.rect), candidate]
      .map((rect) => intersectRects(grow(rect, COLLAR), provisionalLawn))
      .filter((cut): cut is LocalRect => cut !== null)
      .map((cut) => snapTo(cut, provisionalLawn));
    const outline = outlineWithout(provisionalLawn, cuts);
    if (!outline) return false;
    const area = Math.abs(signedArea(outline));
    return area >= (essential ? LAWN_FLOOR.area : LAWN_KEEPS * rectArea(provisionalLawn));
  };

  /**
   * A bay set into a side border, long side along it. At the lawn's near end, where the terrace is a
   * stride away and serves it; or half way down, but only on a side with a corridor, flush against
   * it so the path down that side runs past its face. A room half way down a border nothing runs
   * beside would be the thing the old sampler produced: reachable only across the grass.
   */
  const corridorOn = (side: 'away' | 'gate') => (side === 'away' ? awayCorridor : gateCorridor);
  const sideBay = (want: Want, side: 'away' | 'gate', where: 'near' | 'mid'): LocalRect | null => {
    if (where === 'mid' && !corridorOn(side)) return null;
    /*
     * Where the path runs inside a screen, a bay set into that border would stand across it: the
     * bays assume a path at the fence. The side with no path still takes one.
     */
    if (screens(side) && corridorOn(side)) return null;
    const long = Math.max(want.width, want.depth);
    const short = Math.min(want.width, want.depth);
    const from = corridorOn(side) ? CORRIDOR : FENCE_GAP / 2;
    const v =
      side === 'away' ? span(aIn(from), aIn(from + short)) : span(gIn(from), gIn(from + short));
    const at = where === 'near' ? u0 : (u0 + end) / 2 - long / 2;
    return { u0: at, u1: at + long, ...vRange(v) };
  };

  /*
   * The kinds a *feature* holds. A kind held only for a spare seat is open to a feature whose own
   * bay would not take it: the brief asked for the feature and the spare is surplus. A spare that
   * loses its place this way tries the other spare places after the features are settled.
   */
  /** A bay set into either side border, near the terrace or half way down, as an option. */
  const sideOptions = (want: Want) => {
    const out: { want: Want; rect: LocalRect | null; id: string }[] = [];
    for (const where of ['near', 'mid'] as const) {
      for (const side of ['away', 'gate'] as const) {
        const raw = sideBay(want, side, where);
        const rect = raw ? intersectRects(raw, band) : null;
        const ok =
          rect !== null &&
          seats(want, rect) &&
          !bays.some((bay) => !isNear(bay.kind) && rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9)) &&
          !rectsOverlap(rect, terrace, -1e-9);
        out.push({
          want: { ...want, kind: 'far-room' },
          rect: ok ? rect : null,
          id: `side-${side}-${where}`,
        });
      }
    }
    return out;
  };

  const settledKinds = new Set(
    wants.filter((want) => want.feature !== null).map((want) => want.kind),
  );
  const usedIds = new Set<string>();
  /*
   * The stores first, whatever their priority: the corridors were planned on the strength of where
   * they stand, and a destination placed first can take the far corner a store's path was laid to.
   */
  const order = [...wants.entries()].sort(
    ([a, first], [b2, second]) =>
      Number(!isTurned(first.kind) || first.kind === 'beside-terrace') -
        Number(!isTurned(second.kind) || second.kind === 'beside-terrace') || a - b2,
  );
  for (const [index, want] of order) {
    if (want === play) continue;
    /* The room at the far end of a destination garden is the plan: it goes there or not at all. */
    const essential = want === destination || isEssential(want, index);
    const options: { want: Want; rect: LocalRect | null; id?: string }[] = [
      { want, rect: place(want) },
    ];
    if (want.feature === null && want !== destination) {
      for (const kind of SPARE[language]) {
        if (kind === want.kind) continue;
        const next = wantFor(null, kind, s);
        options.push({ want: next, rect: place(next) });
      }
    }

    if (want.feature && want !== destination) {
      for (const kind of placementLadder(want.feature)) {
        if (!hosts.includes(kind) || settledKinds.has(kind) || kind === want.kind) continue;
        /* A store changes the corridors; a room centred at the far end needs only the walk down the view. */
        if (kind === 'utility' || kind === 'utility-2') continue;
        if (kind === 'lawn-far' && want.feature === 'play') continue;
        const next = wantFor(want.feature, kind, s);
        options.push({ want: next, rect: place(next) });
      }
      if (want.kind !== 'utility' && want.kind !== 'utility-2' && !formal) {
        const centred = wantFor(want.feature, 'lawn-far', s);
        options.push({ want: centred, rect: place(centred), id: 'far-centre' });
        options.push(...sideOptions(want));
      }
    }
    /* A spare seat tucked into a planted edge, where the far corner went to a feature after all. */
    if (want.feature === null && want !== destination && !formal) {
      options.push(...sideOptions(want));
    }

    const chosen = options.find(
      (option) =>
        option.rect !== null &&
        !usedIds.has(option.id ?? option.want.kind) &&
        lawnKeeps(option.rect, essential),
    );
    if (!chosen) {
      /*
       * Never refuse what the brief calls essential. A composition that cannot seat the room the
       * garden is for declines the plot, and the hand-drawn template — which will put it somewhere
       * — draws it instead: a composed plan missing its dining table is worse than an uncomposed
       * one that has it.
       */
      if (essential && (want.feature || want === destination)) return null;
      dropped.push(want.feature ?? 'a second seating area');
      continue;
    }
    const id = chosen.id ?? chosen.want.kind;
    usedIds.add(id);
    if (id === chosen.want.kind) settledKinds.add(chosen.want.kind);
    bays.push({ ...bayOf(chosen.want, chosen.rect!), id });
  }

  /*
   * The play area stands on the grass at the lawn's far end, in the view from the doors — where it
   * can be watched and where the walk down the axis ends. Where a room already holds the far end of
   * the axis it stands beside the gate-side path instead, reached from that.
   */
  /*
   * The destination may have been stood in front of a store that took its end of the garden, which
   * moves its front towards the house — so the lawn is measured against where it actually landed.
   */
  const destinationBay = destination ? (bays.find((bay) => bay.kind === 'far-room') ?? null) : null;
  const lawnU1 = formal
    ? Math.min(
        end,
        Math.min(
          D,
          ...bays.filter((bay) => bay.kind === 'axis-end').map((bay) => bay.rect.u0 - 0.3),
        ),
      )
    : destinationBay
      ? Math.min(end, lawnBefore(destinationBay.rect.u0))
      : end;
  const onTheAxis = (bay: Bay) =>
    bay.feature !== 'play' &&
    (bay.kind === 'axis-end' ||
      bay.kind === 'lawn-far' ||
      (bay.kind === 'far-room' && !diagonal)) &&
    bay.rect.v0 <= 0 &&
    bay.rect.v1 >= 0;
  /*
   * A destination behind its screen does not hold the far end of the *lawn*: the play area may still
   * stand on the axis there, reached down the walk, with the room beyond it glimpsed past the screen.
   */
  const axisTaken = bays.some((bay) => onTheAxis(bay) && bay !== destinationBay);
  /*
   * The play area stands on the grass at the lawn's far end, on the axis — where it can be watched
   * from the doors and where the walk down the view ends. Where a room already holds the far end of
   * the axis, the play area stands *beside* the walk instead, a stride off it on the gate side, still
   * in the view and reached from the walk as it passes. The first version put it by the side path,
   * which on a plan with a border between the path and the lawn was nowhere near it.
   */
  let playBeside: Bay | null = null;
  if (play) {
    /*
     * In a destination garden, never deeper than the lawn it stands on. A bay that ran back onto
     * the terrace was refused at its anchor, and the fitter's nudge then carried the play area
     * forward into the path along the far room's front. Only there: on a shallow lawn with planting
     * beyond it, that same nudge is what seats a play area the lawn alone is too shallow for, and
     * clamping it everywhere left the play area unplaced and every such plan out of the field.
     */
    const depth = Math.min(
      play.depth,
      destinationBay ? lawnU1 - u0 : Infinity,
      Math.max((lawnU1 - u0) * 0.45, (play.minSize?.depth ?? 0) + 2 * BAY_MARGIN),
    );
    const width = Math.min(play.width, lawnV[1] - lawnV[0] - 1);
    if (!axisTaken) {
      bays.push(bayOf(play, { u0: lawnU1 - depth, u1: lawnU1, v0: -width / 2, v1: width / 2 }));
    } else {
      /*
       * Beside the walk, as wide as the lawn on that side allows down to the play area's own floor;
       * failing that, on the axis in front of the far room, where the walk ends at the play area and
       * the room behind it stays in view. A play area in view with nothing leading past it beats no
       * play area at all.
       */
      const beside = [g, -g]
        .map((sign) => {
          const room = sign > 0 ? lawnV[1] - SERVE : -SERVE - lawnV[0];
          const v = span(sign * SERVE, sign * (SERVE + Math.min(width, room)));
          return seats(play, { u0: lawnU1 - depth, u1: lawnU1, ...vRange(v) }) ? v : null;
        })
        .find((v) => v !== null);
      if (beside) {
        playBeside = bayOf(play, { u0: lawnU1 - depth, u1: lawnU1, ...vRange(beside) });
        bays.push(playBeside);
      } else {
        bays.push(bayOf(play, { u0: lawnU1 - depth, u1: lawnU1, v0: -width / 2, v1: width / 2 }));
      }
    }
  }

  /* ---- 6. the corridors, and the lawn notched only where a room or a corridor reaches into it ---- */

  const corridors: Corridor[] = [];
  const circulation: CirculationEdge[] = [];
  const lawnRect: LocalRect = { u0, u1: lawnU1, v0: lawnV[0], v1: lawnV[1] };

  /** A trunk down one side: along the terrace edge if it must, down the fence, then along the rooms' fronts. */
  const trunk = (
    side: 'gate' | 'away',
    rearTargets: Bay[],
    passes: Bay[],
    name: string,
    tier: CirculationEdge['tier'],
    purpose: ElementPurpose,
  ) => {
    /* Rooms beside the corridor are passed on the way; with nothing at the far end, the last is the end. */
    const targets = rearTargets.length > 0 ? rearTargets : passes.slice(-1);
    const passed = rearTargets.length > 0 ? passes : passes.slice(0, -1);
    if (targets.length === 0) return;
    const vc = corridorAt(side);
    const vs = leaves(vc);
    const via: LocalPoint[] = [];
    if (Math.abs(vs - vc) > 1e-6) {
      via.push({ u: T + SERVE, v: vs }, { u: T + SERVE, v: vc });
      /* The leg's own length, plus half a corridor at each end, so the whole strip is kept. */
      const [from, to] = span(vs, vc);
      corridors.push({
        name: `${side} step-out`,
        route: name,
        rect: { u0: T, u1: T + CORRIDOR, v0: from - SERVE, v1: to + SERVE },
      });
    }
    const front = Math.min(...targets.map((bay) => bay.rect.u0));
    const turnU = front - SERVE;
    /* A vertex level with each room it passes, so it is seen to reach it. */
    for (const bay of [...passed].sort((a, b2) => a.rect.u0 - b2.rect.u0)) {
      const mid = (bay.rect.u0 + bay.rect.u1) / 2;
      if (mid < turnU - 0.5) via.push({ u: mid, v: vc });
    }
    via.push({ u: turnU, v: vc });
    corridors.push({
      name: `${side} corridor`,
      route: name,
      rect: { u0: T, u1: front, ...vRange(span(vc - SERVE, vc + SERVE)) },
    });

    const sideFence = side === 'gate' ? gateFence : awayFence;
    const ordered = [...targets].sort(
      (a, b2) => distanceFrom(sideFence, a.rect) - distanceFrom(sideFence, b2.rect),
    );
    let last = vc;
    for (const bay of ordered) {
      const mid = (bay.rect.v0 + bay.rect.v1) / 2;
      if (bay.rect.v0 - 1e-6 <= vc && vc <= bay.rect.v1 + 1e-6) continue;
      via.push({ u: turnU, v: mid });
      corridors.push({
        name: `${side} row`,
        route: name,
        rect: { u0: front - CORRIDOR, u1: front, ...vRange(span(last, past(last, mid))) },
      });
      last = mid;
    }
    const farthest = ordered[ordered.length - 1]!;
    circulation.push({
      name,
      from: { u: T, v: vs },
      to: {
        slot: farthest.id,
        or: [...ordered.slice(0, -1).reverse(), ...passed].map((bay) => bay.id),
      },
      via,
      tier,
      purpose,
    });
  };

  const gateTargets = bays.filter((bay) => bay.kind === 'utility' || bay.kind === 'utility-2');
  if (formal) {
    for (const bay of gateTargets) {
      const side = ((bay.rect.v0 + bay.rect.v1) / 2) * g > 0 ? 'gate' : 'away';
      trunk(
        side,
        [bay],
        [],
        bay.kind === 'utility' ? 'Path to the shed' : 'Path to the kitchen garden',
        'primary',
        'utility-route',
      );
    }
  } else {
    const beside = (side: 'gate' | 'away') => bays.filter((bay) => bay.id === `side-${side}-mid`);
    /* Route names are the key a `reroute` repair uses, so no two in one plan may share one. */
    const gateName = gateTargets.some((bay) => bay.kind === 'utility')
      ? 'Path to the shed'
      : 'Garden path';
    trunk(
      'gate',
      gateTargets,
      [...beside('gate'), ...(shareGate && destinationBay ? [destinationBay] : [])],
      gateName,
      'primary',
      gateTargets.length > 0 ? 'utility-route' : 'garden-route',
    );
    /*
     * On a garden too narrow for a second path, the destination is reached by a branch off the path
     * to the store, run along its front. Passing its side was the first answer and a fragile one: the
     * path runs just inside the distance that counts as reaching a room, and a round feature
     * tessellated inside its bay lands a few centimetres outside it.
     */
    const trunkLaid = circulation.find((edge) => edge.name === gateName);
    if (shareGate && destinationBay && trunkLaid) {
      const vc = corridorAt('gate');
      const front = destinationBay.rect.u0;
      const mid = (destinationBay.rect.v0 + destinationBay.rect.v1) / 2;
      const name = `Path to the ${describeBay(destinationBay)}`;
      corridors.push({
        name: 'gate branch row',
        route: name,
        rect: { u0: front - CORRIDOR, u1: front, ...vRange(span(vc, past(vc, mid))) },
      });
      circulation.push({
        name,
        from: { u: front - SERVE, v: vc },
        to: { slot: destinationBay.id },
        via: [{ u: front - SERVE, v: mid }],
        tier: 'secondary',
        purpose: 'garden-route',
        branch: gateName,
      });
    }
    trunk(
      'away',
      bays.filter(
        (bay) => bay.id === 'far-room' && (diagonal || (bay === destinationBay && !shareGate)),
      ),
      beside('away'),
      gateName === 'Garden path' && (gateTargets.length > 0 || beside('gate').length > 0)
        ? 'Path down the garden'
        : 'Garden path',
      'secondary',
      'garden-route',
    );
  }

  /* The walk down the axis, to whatever stands at the far end of the view. */
  /*
   * Never to a destination behind its screen: the path down the side is its walk, and a second one
   * straight across the lawn and through the planting would undo the point of the screen.
   */
  const axisTarget =
    bays.find((bay) => bay.feature === 'play' && bay !== playBeside) ??
    bays.find((bay) => onTheAxis(bay) && bay !== destinationBay);
  const axis: LocalRect | null = formal
    ? {
        u0: T,
        u1: (axisTarget ? axisTarget.rect.u0 : lawnU1) - 0.05,
        v0: -AXIS_WIDTH / 2,
        v1: AXIS_WIDTH / 2,
      }
    : null;
  if (axisTarget && !formal) {
    circulation.push({
      name: 'Garden walk',
      from: { u: T, v: 0 },
      to: { slot: axisTarget.id },
      /* A vertex level with the play area, so the walk is seen to serve it as it passes. */
      via: playBeside ? [{ u: (playBeside.rect.u0 + playBeside.rect.u1) / 2, v: 0 }] : [],
      tier: 'decorative',
      purpose: 'axis',
    });
  }

  /*
   * The way in from the side gate, kept clear. A gate level with the terrace brings its path
   * straight across to it, through whatever would otherwise be the terrace's flank bed — so that
   * strip is a corridor, not planting, and the path does not cut a bed in two on its way in.
   */
  const arrival = request.gate;
  if (request.gateSide && arrival && arrival.u < T) {
    const along = clamp(arrival.u, band.u0 + SERVE, T - SERVE);
    const edge = g > 0 ? terrace.v1 : terrace.v0;
    corridors.push({
      name: 'arrival',
      route: 'Side path',
      rect: { u0: along - SERVE, u1: along + SERVE, ...vRange(span(edge, gateFence)) },
    });
  }

  /*
   * A sequence's first divider has an opening in front of the doors: the view out and the way onto
   * the lawn. Kept as a corridor, so the planting is drawn either side of it and never across it.
   */
  if (sequence) {
    const half = Math.max(doorHalf + 0.3, SERVE);
    corridors.push({ name: 'lawn entrance', rect: { u0: T, u1: u0, v0: -half, v1: half } });
  }

  if (request.gateSide) {
    circulation.push({
      name: 'Side path',
      from: { u: 0, v: (request.gateSide === 'left' ? -1 : 1) * (room.vMax - room.vMin) },
      to: { gate: true },
      via: [],
      tier: 'primary',
      purpose: 'access-route',
    });
  }

  /*
   * The lawn, notched round every room that reaches into it — with a collar of planting — and round
   * any corridor that crosses its corner. A notch that would leave a hole or split the lawn in two
   * refuses the room rather than the lawn, and so does one that would leave the lawn under
   * `LAWN_KEEPS` of its rectangle: the open ground is the thing the rooms stand round.
   */
  const cutsFor = (list: Bay[]) =>
    [
      ...list
        .filter((bay) => bay.feature !== 'play')
        .map((bay) => intersectRects(grow(bay.rect, COLLAR), lawnRect)),
      ...corridors.map((corridor) => intersectRects(corridor.rect, lawnRect)),
    ]
      .filter((cut): cut is LocalRect => cut !== null)
      .map((cut) => snapTo(cut, lawnRect));

  /*
   * How much of the lawn the rooms may take depends on how much they are wanted. The rooms the brief
   * wants most — the first `PROTECTED` in priority order — may take it down to its floor, because on
   * a small plot the lawn gives way to the dining table rather than the other way round. Everything
   * else must leave it `LAWN_KEEPS` of its rectangle, and is refused first when it would not.
   */
  const essential = request.essential;
  const rank = (bay: Bay) => {
    if (bay === destinationBay) return 0;
    if (essential) return bay.feature !== null && essential.includes(bay.feature) ? 0 : PROTECTED;
    const at = wants.findIndex((want) => want.feature === bay.feature);
    return at === -1 ? wants.length : at;
  };
  const area = (points: LocalPoint[] | null) => (points ? Math.abs(signedArea(points)) : 0);
  const keeps = (points: LocalPoint[] | null, strict: boolean) =>
    points !== null && area(points) >= (strict ? LAWN_KEEPS * rectArea(lawnRect) : LAWN_FLOOR.area);
  const intruding = (bay: Bay) =>
    bay.feature !== 'play' && intersectRects(grow(bay.rect, COLLAR), lawnRect) !== null;

  let outline = outlineWithout(lawnRect, cutsFor(bays));
  for (;;) {
    const lesser = bays.some((bay) => intruding(bay) && rank(bay) >= PROTECTED);
    if (keeps(outline, lesser)) break;
    const intruder = [...bays].reverse().find((bay) => intruding(bay) && rank(bay) >= PROTECTED);
    /*
     * Only a room the brief most wants is left in the way, and the lawn still cannot stay at its
     * floor: on this plot, for this brief, there is no lawn worth composing round. The composition
     * declines rather than refusing the dining table, and the hand-drawn template — which knows how
     * to lay a small room out as a courtyard — draws it instead.
     */
    if (!intruder) {
      if (bays.some(intruding)) return null;
      break;
    }
    bays.splice(bays.indexOf(intruder), 1);
    dropped.push(intruder.feature ?? 'a second seating area');
    for (let i = circulation.length - 1; i >= 0; i -= 1) {
      const to = circulation[i]!.to;
      if (
        'slot' in to &&
        to.slot === intruder.id &&
        !(to.or ?? []).some((id) => bays.some((bay) => bay.id === id))
      ) {
        const [gone] = circulation.splice(i, 1);
        /* Its corridors go with it, or the lawn stays notched for a path nobody lays. */
        for (let c = corridors.length - 1; c >= 0; c -= 1) {
          if (corridors[c]!.route === gone!.name) corridors.splice(c, 1);
        }
      }
    }
    outline = outlineWithout(lawnRect, cutsFor(bays));
  }
  /* Whatever language, a lawn under its floor is not the open space a composition stands round. */
  if (
    !outline ||
    area(outline) < LAWN_FLOOR.area ||
    lawnRect.u1 - lawnRect.u0 < LAWN_FLOOR.minDimension
  ) {
    return null;
  }

  const intrusions = bays.filter(
    (bay) => bay.feature !== 'play' && intersectRects(grow(bay.rect, COLLAR), lawnRect),
  );
  const soft = language === 'soft_organic' ? softLawn(lawnRect, bays, corridors, params, g) : null;
  /* A sweeping lawn under the floor is a rug with curves: decline, as for a courtyard. */
  if (soft && Math.abs(signedArea(soft)) < LAWN_FLOOR.area) return null;
  const openSpace: OpenSpace = {
    rect: lawnRect,
    shape: soft
      ? { kind: 'polygon', points: soft }
      : { kind: 'polygon', points: outline, styleCorners: language === 'rectilinear' },
    category: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
  };
  if (intrusions.length > 0 && !soft) {
    decisions.push({
      kind: 'lawn-notched',
      text: `Notched the lawn round ${intrusions.length === 1 ? 'one room' : `${intrusions.length} rooms`} rather than standing ${intrusions.length === 1 ? 'it' : 'them'} on the grass.`,
    });
  }
  const paths = circulation.filter((edge) => edge.purpose !== 'access-route');
  if (paths.length > 0) {
    decisions.push({
      kind: 'circulation',
      text: `Laid ${paths.length === 1 ? 'one path' : `${paths.length} paths`} beside the lawn${paths.some((edge) => edge.purpose === 'axis') ? ' and a walk down the view' : ''} rather than a path across the grass to each room.`,
    });
  }

  /* ---- 8. what terminates the view ---- */

  const axisEnd = request.view?.axisEnd ?? { u: D, v: 0 };
  const spansView = (bay: Bay) =>
    REAR.includes(bay.kind) && bay.rect.v0 - 0.5 <= axisEnd.v && bay.rect.v1 + 0.5 >= axisEnd.v;
  /*
   * A destination on the view line is what the eye meets, even where a narrow garden stands a store
   * behind it on the same line: the store is behind the room, and the room is the point.
   */
  const onAxis =
    (destinationBay && spansView(destinationBay) ? destinationBay : undefined) ??
    bays.find(spansView);
  if (onAxis) {
    onAxis.purpose = 'focal';
    decisions.push({
      kind: 'focal',
      text: `Put the ${describeBay(onAxis)} at the end of the view from the doors, so the eye has somewhere to land.`,
    });
  }

  /* Whether the destination has its screen, or the lawn runs up to the path along its front. */
  const screened =
    destinationBay !== null && destinationBay.rect.u0 - CORRIDOR - lawnU1 >= BED_MIN_DEPTH - 1e-9;
  if (destinationBay) {
    decisions.push({
      kind: 'destination',
      text: sequence
        ? `Broke the length into rooms: the terrace, a lawn entered through the planting, and the ${describeBay(destinationBay)} at the far end${screened ? ' behind a planted divider' : ''}, reached down the side rather than across the grass.`
        : screened
          ? `Made the ${describeBay(destinationBay)} the reason to go out: at the far end behind a planted screen, reached down the side of the lawn rather than across it.`
          : `Made the ${describeBay(destinationBay)} the reason to go out, at the far end past the lawn and reached down its side.`,
    });
  }

  /* The utility bays stay out of the view from the doors wherever the plot lets them. */
  const cone = request.view?.cone ?? null;
  for (const bay of bays.filter((b2) => b2.kind === 'utility' || b2.kind === 'utility-2')) {
    if (cone && cone.some((point) => inRect(point, bay.rect))) {
      decisions.push({
        kind: 'utility-in-view',
        text: `The ${describeBay(bay)} could not be kept wholly out of the view from the doors on a garden this narrow.`,
      });
    } else {
      decisions.push({
        kind: 'utility-out-of-view',
        text: `Kept the ${describeBay(bay)} in a far corner${bay.kind === 'utility' && request.gateSide ? ', on the gate side' : ''}, out of the view from the doors.`,
      });
    }
  }

  /* ---- 9. the planting: what the lawn, the rooms and the corridors leave ---- */

  const masses = plantingMasses({
    room,
    terrace,
    lawn: lawnRect,
    lawnOutline: soft ? rectPoints(lawnRect) : outline,
    wedges: soft ? wedgesOf(lawnRect, soft) : [],
    bays: bays.filter((bay) => !isNear(bay.kind)),
    near: bays.filter((bay) => isNear(bay.kind)).map((bay) => bay.rect),
    corridors,
    axis,
    gateFence,
    g,
    formal,
    enclosing: screened,
    sequence,
    screening: { gate: screens('gate'), away: screens('away') },
  });

  /* ---- 10. trees, each for a reason ---- */

  const trees = planTrees({
    D,
    lawn: lawnRect,
    bays,
    masses,
    focal: onAxis ? null : axisEnd,
    g,
    rearSpan: [vLo, vHi],
    scale: s,
    /*
     * A pair in the screen either side of the destination, so from the doors the far end is
     * glimpsed between them rather than seen whole: the reason to walk down and look.
     */
    glimpse:
      screened && destinationBay
        ? {
            u: (lawnU1 + destinationBay.rect.u0 - CORRIDOR) / 2,
            vs: [destinationBay.rect.v0 - 1, destinationBay.rect.v1 + 1],
          }
        : null,
  });

  const focal: GardenComposition['focal'] = onAxis
    ? { kind: 'feature', bay: onAxis.id }
    : trees.some((tree) => tree.role === 'focal')
      ? { kind: 'tree', at: trees.find((tree) => tree.role === 'focal')!.at }
      : null;

  if (dropped.length > 0) {
    decisions.push({
      kind: 'no-room',
      text: `There was no bay for ${dropped.join(', ')} that did not mean standing it on the lawn.`,
    });
  }

  return {
    archetype: input.archetype,
    language,
    terrace,
    openSpace,
    bays,
    corridors,
    circulation,
    focal,
    masses,
    trees,
    axis,
    axisStops: formal && playBeside ? [(playBeside.rect.u0 + playBeside.rect.u1) / 2] : [],
    decisions,
  };
}

/* ---------------------------------------------------------------- the rooms */

export function wantFor(feature: DesiredFeature | null, kind: SlotKind, s: number): Want {
  const spec = FEATURE_SPECS[feature ?? 'seating'];
  const fp = spec.footprint;
  let along = fp.kind === 'point' ? fp.radius * 2 * s : fp.width * s;
  let out = fp.kind === 'point' ? fp.radius * 2 * s : fp.depth * s;
  /* A store and a working bay stand long side to the fence. */
  if ((kind === 'utility' || kind === 'utility-2') && out > along) [along, out] = [out, along];

  /*
   * The floor a bay holds the feature to — never more than the footprint actually being placed.
   *
   * The library's floor is what the feature holds (a table and its chairs) and does not scale; the
   * footprint the fitter is handed does, sub-linearly, down to 0.6 of its suburban size. On a small
   * plot the two cross, and a floor above the footprint is a slot nothing can ever be seated in: the
   * fitter shrinks and never grows. Capped, the floor still stops a feature being shrunk below what
   * it holds wherever the footprint was bigger than that to begin with. Growing a footprint up to its
   * floor is the proportional-sizing work, and it belongs where every placement reads it.
   */
  const min = feature ? FEATURE_LIBRARY[feature].minSize : undefined;
  const [fpShort, fpLong] = [Math.min(along, out), Math.max(along, out)];
  const minSize = min
    ? min.kind === 'point'
      ? { width: Math.min(min.radius * 2, fpShort), depth: Math.min(min.radius * 2, fpShort) }
      : (() => {
          const [short, long] = [Math.min(min.width, min.depth), Math.max(min.width, min.depth)];
          return { width: Math.min(short, fpShort), depth: Math.min(long, fpLong) };
        })()
    : undefined;

  return {
    feature,
    kind,
    footprint:
      fp.kind === 'point'
        ? { kind: 'point', radius: fp.radius * s }
        : { kind: 'rect', width: fp.width * s, depth: fp.depth * s },
    width: along + 2 * BAY_MARGIN,
    depth: out + 2 * BAY_MARGIN,
    ...(minSize ? { minSize } : {}),
  };
}

/**
 * Whether the feature will actually be seated in this bay — asked exactly as `fitInSlot` will ask
 * it, with the same two functions.
 *
 * A bay can be larger than a feature's floor on both sides and still not seat it, because the fitter
 * scales a footprint *uniformly*: a near-square play area whose floor is long and thin never reaches
 * that floor's long side in a narrow bay. Checked here with a rule of its own, the composition kept a
 * bay the fitter then refused, and a concept lost an essential feature with a room drawn for it.
 */
export function seats(want: Want, rect: LocalRect): boolean {
  if (!want.minSize) return true;
  const slot = {
    maxSize: { width: rect.v1 - rect.v0, depth: rect.u1 - rect.u0 },
    ...(isTurned(want.kind) ? { turn: true } : {}),
  };
  const sized = sizeToSlot(want.footprint, slot as Slot);
  return floorScale(sized, want.minSize) <= 1 + 1e-9;
}

export function isTurned(kind: SlotKind): boolean {
  return kind === 'utility' || kind === 'utility-2' || kind === 'beside-terrace';
}

export function bayOf(want: Want, rect: LocalRect): Bay {
  return {
    id: want.kind,
    kind: want.kind,
    zoneId: want.feature ? FEATURE_LIBRARY[want.feature].zone : 'lounge',
    feature: want.feature,
    rect,
    purpose:
      want.feature === 'water'
        ? 'water'
        : want.feature === null
          ? 'lounge'
          : PURPOSE_BY_KIND[want.kind],
    ...(want.kind === 'utility' || want.kind === 'utility-2' || want.kind === 'beside-terrace'
      ? { turn: true }
      : {}),
    ...(want.minSize ? { minSize: want.minSize } : {}),
  };
}

/**
 * The near-house bays: at the end of the terrace along the wall, and beside it on the gate side —
 * where the hand-drawn templates put them, off the lawn by construction.
 *
 * Sized to the ground actually free between the terrace and the fence rather than centred on an
 * anchor and clipped, which is how a pergola that fitted the three metres beside a terrace exactly
 * came to be refused: the anchor put it half a metre over the fence, and the clip left 2.9.
 */
function nearBays(
  request: SketchRequest,
  terrace: LocalRect,
  s: number,
  formal: boolean,
  g: number,
  band: LocalRect,
): Partial<Record<SlotKind, LocalRect>> {
  const endLeft = formal || g > 0;
  const endDepth = Math.max(PERGOLA_FLOOR.depth, terrace.u1 - terrace.u0);
  const endWidth = 3.6 * s;
  const endSpan = endLeft
    ? { v0: Math.max(band.v0, terrace.v0 - endWidth), v1: terrace.v0 }
    : { v0: terrace.v1, v1: Math.min(band.v1, terrace.v1 + endWidth) };
  const endU = (terrace.u0 + terrace.u1) / 2;

  const besideRight = formal || g > 0;
  const besideWidth = 3.2 * s;
  const besideSpan = besideRight
    ? { v0: terrace.v1, v1: Math.min(band.v1, terrace.v1 + besideWidth + 0.2) }
    : { v0: Math.max(band.v0, terrace.v0 - besideWidth - 0.2), v1: terrace.v0 };

  return {
    'terrace-end': {
      u0: Math.max(band.u0, endU - endDepth / 2),
      u1: endU + endDepth / 2,
      ...endSpan,
    },
    'beside-terrace': { u0: band.u0 + 0.05, u1: band.u0 + 0.05 + 1.5 * s, ...besideSpan },
  };
}

/**
 * A notch whose edge falls just short of the lawn's own edge is widened to meet it.
 *
 * Otherwise a step-out that starts a hand's breadth in from the lawn's side leaves a sliver of grass
 * beside it and two inside corners where one would do — the lawn reads as nibbled rather than cut.
 */
const SNAP = 0.8;
export function snapTo(cut: LocalRect, lawn: LocalRect): LocalRect {
  return {
    u0: cut.u0 - lawn.u0 < SNAP ? lawn.u0 : cut.u0,
    u1: lawn.u1 - cut.u1 < SNAP ? lawn.u1 : cut.u1,
    v0: cut.v0 - lawn.v0 < SNAP ? lawn.v0 : cut.v0,
    v1: lawn.v1 - cut.v1 < SNAP ? lawn.v1 : cut.v1,
  };
}

function isNear(kind: SlotKind): boolean {
  return kind === 'terrace-end' || kind === 'beside-terrace';
}

function formalTerrace(request: SketchRequest, room: Room, params: CandidateParams): LocalRect {
  const floor = terraceFloor(room);
  const hw = Math.max(Math.min(-room.vMin, room.vMax), floor.width / 2);
  const depth = terraceDepth(request.scale, room.uMax, params.terraceDepth);
  const width = Math.max(floor.width, Math.min(terraceWidth(request, room), 2 * hw - 0.8));
  const [v0, v1] = clampToRoom(width, room, (request.doorWidth ?? 0) / 2);
  return { u0: Math.max(room.uMin, 0), u1: Math.max(room.uMin, 0) + depth, v0, v1 };
}

/**
 * Where a row of corridor running from `from` to a turn at `to` has to end: half a corridor past
 * the turn. Ended at the turn itself, the planting starts at the corner the route turns round, and
 * the route's own width takes a bite out of the bed there.
 */
function past(from: number, to: number): number {
  return to + Math.sign(to - from) * SERVE;
}

export function vRange([v0, v1]: [number, number]): { v0: number; v1: number } {
  return { v0, v1 };
}

function distanceFrom(fence: number, rect: LocalRect): number {
  return Math.min(Math.abs(rect.v0 - fence), Math.abs(rect.v1 - fence));
}

export function describeBay(bay: Bay): string {
  if (!bay.feature) return 'second seating area';
  return (FEATURE_SPECS[bay.feature].planName ?? bay.feature).toLowerCase();
}

/* ---------------------------------------------------------------- the soft lawn */

/** How many points the soft lawn's outline is sampled at, and how far it bulges and pinches. */
const SOFT_SAMPLES = 28;
const SOFT_WAVE = 0.13;

/**
 * An ellipse inscribed in the lawn's rectangle, waved on two lobes, and pulled back wherever it
 * would reach into a room — so each bay leaves a concave sweep in the lawn rather than a notch.
 * The same outline the curved template drew, measured against a panel that was reserved first.
 */
function softLawn(
  rect: LocalRect,
  bays: Bay[],
  corridors: Corridor[],
  params: CandidateParams,
  g: number,
): LocalPoint[] {
  const cu = (rect.u0 + rect.u1) / 2;
  const cv = (rect.v0 + rect.v1) / 2;
  const a = (rect.u1 - rect.u0) / 2;
  const bb = (rect.v1 - rect.v0) / 2;
  const bulgeRight = params.lawnBias === 'away' ? g < 0 : g > 0;
  const phase = bulgeRight ? Math.PI / 4 : -Math.PI / 4 + Math.PI;
  const keepOut = [
    ...bays.filter((bay) => bay.feature !== 'play').map((bay) => grow(bay.rect, COLLAR)),
    ...corridors.map((corridor) => corridor.rect),
  ];

  const points: LocalPoint[] = [];
  for (let i = 0; i < SOFT_SAMPLES; i += 1) {
    const theta = (i / SOFT_SAMPLES) * Math.PI * 2;
    const r = 1 + SOFT_WAVE * Math.sin(2 * theta + phase);
    let t = 1;
    const at = (scale: number): LocalPoint => ({
      u: clamp(cu + a * r * scale * Math.cos(theta), rect.u0, rect.u1),
      v: clamp(cv + bb * r * scale * Math.sin(theta), rect.v0, rect.v1),
    });
    /* Pulled in along its own ray until it clears every room's collar. */
    while (t > 0.35 && keepOut.some((cut) => inRect(at(t), cut))) t -= 0.05;
    points.push(at(t));
  }
  return points;
}

/**
 * The four pieces of the lawn's rectangle the curve leaves, one per corner, as planting.
 *
 * What makes a soft lawn's beds follow its edge exactly rather than meet it in a staircase or
 * overlap it and be cut later. The outline is sampled in quarters — `SOFT_SAMPLES` is a multiple of
 * four, so a sample lands on each axis — and each quarter's arc closes on the rectangle's corner.
 */
function wedgesOf(rect: LocalRect, lawn: LocalPoint[]): LocalPoint[][] {
  const quarter = SOFT_SAMPLES / 4;
  const corners: LocalPoint[] = [
    { u: rect.u1, v: rect.v1 },
    { u: rect.u0, v: rect.v1 },
    { u: rect.u0, v: rect.v0 },
    { u: rect.u1, v: rect.v0 },
  ];
  /*
   * Each arc starts and ends on an axis of the ellipse, and the wave can leave either end short of
   * the rectangle. So each wedge runs out to the rectangle's edge at both ends, square to it, or the
   * gap between two neighbouring wedges is a sliver of bare ground along the lawn's side.
   */
  const toEdge = (point: LocalPoint, k: number): LocalPoint =>
    k % 2 === 0
      ? { u: k === 0 ? rect.u1 : rect.u0, v: point.v }
      : { u: point.u, v: k === 1 ? rect.v1 : rect.v0 };
  return corners.map((corner, k) => {
    const arc = Array.from(
      { length: quarter + 1 },
      (_, i) => lawn[(k * quarter + i) % lawn.length]!,
    );
    return [corner, toEdge(arc[0]!, k), ...arc, toEdge(arc[arc.length - 1]!, (k + 1) % 4)];
  });
}

export function rectPoints(rect: LocalRect): LocalPoint[] {
  return [
    { u: rect.u0, v: rect.v0 },
    { u: rect.u1, v: rect.v0 },
    { u: rect.u1, v: rect.v1 },
    { u: rect.u0, v: rect.v1 },
  ];
}

/* ---------------------------------------------------------------- the planting */

export interface MassInput {
  room: Room;
  terrace: LocalRect;
  lawn: LocalRect;
  /** The lawn's exact outline — for a soft lawn, its rectangle, with the curve's corners as `wedges`. */
  lawnOutline: LocalPoint[];
  wedges: LocalPoint[][];
  bays: Bay[];
  near: LocalRect[];
  corridors: Corridor[];
  axis: LocalRect | null;
  gateFence: number;
  g: number;
  formal: boolean;
  /** Whether the planting beyond the lawn is a destination garden's screen rather than a backdrop. */
  enclosing: boolean;
  /**
   * A sequence of rooms: the band between the terrace and the lawn is a planted divider rather than
   * an open threshold, and the planting between the rooms is named for dividing them.
   */
  sequence: boolean;
  /** Which side borders are a screen the brief asked for, and are named for it. */
  screening?: { gate: boolean; away: boolean };
  /**
   * A side-by-side plan: the lawn lies beside the terrace along the wall rather than behind it, on
   * this side of it (`+1` towards `vMax`). The beds are named by where they are relative to that —
   * behind the lawn, past its far end, between it and the terrace, or on the terrace's other side.
   */
  beside?: 1 | -1;
}

/**
 * The planting is what the lawn, the rooms and the corridors leave — named for what it does.
 *
 * Found as cells rather than drawn as shapes, so nothing is left over and nothing overlaps: every
 * cell of the room is the terrace, the lawn, a room, a corridor, the threshold in front of the doors,
 * or planting. The planting cells are then grouped by where they are — behind the lawn, down each
 * side, beside the terrace — and each group becomes a bed with a purpose: the rear border is the
 * backdrop, the sides frame the lawn, the ground round the store screens it, the beds by the terrace
 * are the threshold.
 *
 * A soft lawn is the one shape cells cannot follow, so the cells stop at its rectangle and the four
 * corners the curve leaves are added as beds of their own, each bounded by the arc exactly.
 */
export function plantingMasses(input: MassInput): PlantingMass[] {
  const { room, terrace, lawn, lawnOutline, wedges, bays, near, corridors, axis, g } = input;
  const bounds: LocalRect = {
    u0: Math.max(room.uMin, 0) + 0.3,
    u1: room.uMax,
    v0: room.vMin,
    v1: room.vMax,
  };
  const threshold: LocalRect = { u0: terrace.u1, u1: lawn.u0, v0: lawn.v0, v1: lawn.v1 };
  /*
   * The strip between a room and the fence, where it is thinner than a bed, is left as the gap it
   * is — room to get round the back of a store — rather than planted. Planted, it closed a ring of
   * planting round the room, a bed with a hole in it; a bed is drawn by its outer ring, so the room
   * vanished into the planting as far as anything measuring the plan could tell, and the path that
   * arrived at the store was reported as cutting through a border.
   */
  const slivers = bays.flatMap((bay): LocalRect[] => {
    const { u0, u1, v0, v1 } = bay.rect;
    const out: LocalRect[] = [];
    if (room.vMax - v1 > 0 && room.vMax - v1 < BED_MIN_DEPTH)
      out.push({ u0, u1, v0: v1, v1: room.vMax });
    if (v0 - room.vMin > 0 && v0 - room.vMin < BED_MIN_DEPTH)
      out.push({ u0, u1, v0: room.vMin, v1: v0 });
    if (room.uMax - u1 > 0 && room.uMax - u1 < BED_MIN_DEPTH)
      out.push({ u0: u1, u1: room.uMax, v0, v1 });
    return out;
  });
  const solids = [
    terrace,
    ...bays.map((bay) => bay.rect),
    ...near,
    ...corridors.map((c) => c.rect),
    ...(axis ? [axis] : []),
    ...slivers,
  ];
  const grid = gridOver(bounds, [lawn, threshold, ...solids, ...lawnCuts(lawnOutline)]);
  const roomPolygon = room.polygon && room.polygon.length >= 3 ? room.polygon : null;

  const planted = (i: number, j: number): boolean => {
    const c = cellCentre(grid, i, j);
    if (roomPolygon && !insideLocal(c, roomPolygon)) return false;
    if (solids.some((rect) => inRect(c, rect))) return false;
    if (!input.sequence && inRect(c, threshold)) return false;
    if (insideLocal(c, lawnOutline)) return false;
    return true;
  };

  const store = bays.find((bay) => bay.kind === 'utility');
  const label = (i: number, j: number): string => {
    const c = cellCentre(grid, i, j);
    if (input.beside) {
      if (store && inRect(c, grow(store.rect, 1.2))) return 'screen';
      if (c.u >= lawn.u1) return 'rear';
      const side = input.beside;
      if ((c.v - (side > 0 ? lawn.v1 : lawn.v0)) * side >= 0) return 'away';
      if ((c.v - (side > 0 ? terrace.v0 : terrace.v1)) * side <= 0) return 'gate';
      return 'flank';
    }
    if (c.u < terrace.u1) return 'flank';
    if (input.sequence && c.u < lawn.u0) return 'divider';
    if (store && inRect(c, grow(store.rect, 1.2))) return 'screen';
    if (c.u >= lawn.u1) return 'rear';
    const mid = (lawn.v0 + lawn.v1) / 2;
    return (c.v - mid) * g > 0 ? 'gate' : 'away';
  };

  const NAMES: Record<string, { name: string; purpose: ElementPurpose }> = {
    rear: input.enclosing
      ? {
          name: input.sequence ? 'Dividing border' : 'Enclosing border',
          purpose: 'screening-planting',
        }
      : { name: 'Rear border', purpose: 'backdrop-planting' },
    divider: { name: 'Dividing border', purpose: 'threshold-planting' },
    away: input.screening?.away
      ? { name: 'Screening border', purpose: 'screening-planting' }
      : { name: input.formal ? 'Side border' : 'Specimen border', purpose: 'framing-planting' },
    gate: input.screening?.gate
      ? { name: 'Screening border', purpose: 'screening-planting' }
      : { name: input.formal ? 'Side border' : 'Flowering border', purpose: 'framing-planting' },
    flank: { name: 'Terrace flank', purpose: 'threshold-planting' },
    screen: { name: 'Screening border', purpose: 'screening-planting' },
  };

  const masses: PlantingMass[] = [];
  for (const key of ['rear', 'away', 'gate', 'screen', 'flank', 'divider']) {
    const loops = loopsOf(grid, (i, j) => planted(i, j) && label(i, j) === key);
    for (const loop of loops) {
      if (!loop.outer) continue;
      if (!wideEnough(loop.points)) continue;
      masses.push({
        name: NAMES[key]!.name,
        shape: { kind: 'polygon', points: loop.points },
        purpose: NAMES[key]!.purpose,
      });
    }
  }

  const mid = (lawn.v0 + lawn.v1) / 2;
  for (const wedge of wedges) {
    if (!wideEnough(wedge)) continue;
    const side = wedge[0]!.u >= lawn.u1 ? 'rear' : (wedge[0]!.v - mid) * g > 0 ? 'gate' : 'away';
    masses.push({
      name: NAMES[side]!.name,
      shape: { kind: 'polygon', points: wedge },
      purpose: NAMES[side]!.purpose,
    });
  }
  return masses;
}

/**
 * The lawn's vertices as zero-size rectangles: all `gridOver` needs is an edge wherever the lawn
 * turns a corner, so a notch's inside corner is a cell boundary like every other edge.
 */
function lawnCuts(outline: LocalPoint[]): LocalRect[] {
  return outline.map((point) => ({ u0: point.u, u1: point.u, v0: point.v, v1: point.v }));
}

/** A bed thinner than the sliver guard everywhere is not a bed; one arm of an L may be. */
function wideEnough(points: LocalPoint[]): boolean {
  const us = points.map((p) => p.u);
  const vs = points.map((p) => p.v);
  const du = Math.max(...us) - Math.min(...us);
  const dv = Math.max(...vs) - Math.min(...vs);
  return (
    Math.min(du, dv) >= BED_MIN_DEPTH &&
    Math.abs(signedArea(points)) >= BED_MIN_DEPTH * BED_MIN_DEPTH * 1.5
  );
}

export function insideLocal(point: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.v > point.v !== b.v > point.v) {
      const u = ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
      if (point.u < u) inside = !inside;
    }
  }
  return inside;
}

/* ---------------------------------------------------------------- the trees */

export interface TreeInput {
  D: number;
  lawn: LocalRect;
  bays: Bay[];
  masses: PlantingMass[];
  /** Where a focal tree should go when no room terminates the view; `null` when one does. */
  focal: LocalPoint | null;
  g: number;
  /** The rear border's extent along `v`, fence to fence. */
  rearSpan: [number, number];
  scale: number;
  /** Where a pair either side of a destination garden's far room should stand, if it has a screen. */
  glimpse: { u: number; vs: number[] } | null;
}

/**
 * Trees for a reason, in the order the reasons matter.
 *
 * A **focal** tree where nothing else terminates the view down the garden. A **framing** pair at the
 * lawn's near corners, which is what turns a rectangle of grass into a space you look into. A
 * **screening** tree between the doors and the store. Then a **backdrop** along the rear border and
 * down the deep side, spaced by the plot's scale — the enclosure, planted where the beds are rather
 * than walked round the fence regardless of what is there.
 *
 * Every point is inside a bed. The realisation plants the first ones that fit, up to the plot's tree
 * budget, so the order here is the priority: a small garden gets its focal tree and its framing pair
 * and nothing else, which is the right answer.
 */
export function planTrees(input: TreeInput): TreePlan[] {
  const { lawn, bays, masses, focal, g, scale } = input;
  const plans: TreePlan[] = [];
  const inBed = (at: LocalPoint) =>
    masses.some((mass) => mass.shape.kind === 'polygon' && insideLocal(at, mass.shape.points));
  const clearOfBays = (at: LocalPoint, by: number) =>
    !bays.some((bay) => inRect(at, grow(bay.rect, by)));
  const clearOfTrees = (at: LocalPoint, by: number) =>
    plans.every((plan) => Math.hypot(plan.at.u - at.u, plan.at.v - at.v) >= by);
  const add = (at: LocalPoint, role: TreePlan['role'], purpose: ElementPurpose, gap = 3) => {
    if (inBed(at) && clearOfBays(at, 1) && clearOfTrees(at, gap)) {
      plans.push({ at, role, purpose });
      return true;
    }
    return false;
  };

  const rearMid = (lawn.u1 + input.D) / 2;

  if (focal) {
    for (const dv of [0, 1, -1, 2, -2, 3, -3]) {
      if (add({ u: rearMid, v: focal.v + dv }, 'focal', 'focal-tree')) break;
    }
  }

  for (const v of input.glimpse?.vs ?? [])
    add({ u: input.glimpse!.u, v }, 'framing', 'framing-tree');

  const awaySide = (lawn.v0 + lawn.v1) / 2 - g * ((lawn.v1 - lawn.v0) / 2 + 1.1);
  const gateSide = (lawn.v0 + lawn.v1) / 2 + g * ((lawn.v1 - lawn.v0) / 2 + 1.1);
  add({ u: lawn.u0 + 1.4, v: awaySide }, 'framing', 'framing-tree');
  add({ u: lawn.u0 + 1.4, v: gateSide }, 'framing', 'framing-tree');

  const store = bays.find((bay) => bay.kind === 'utility');
  if (store) {
    const mid = (store.rect.v0 + store.rect.v1) / 2;
    add({ u: store.rect.u0 - 1.4, v: mid - g * 1.6 }, 'screening', 'screening-tree');
  }

  const spacing = TREE_SPACING * Math.max(0.8, Math.sqrt(scale));
  for (let v = input.rearSpan[0] + 1.2; v <= input.rearSpan[1] - 1.2; v += spacing) {
    add({ u: rearMid, v }, 'backdrop', 'backdrop-tree', spacing * 0.8);
  }
  for (let u = lawn.u0 + 1.4 + spacing; u < lawn.u1; u += spacing) {
    add({ u, v: awaySide }, 'backdrop', 'backdrop-tree', spacing * 0.8);
  }
  return plans;
}
