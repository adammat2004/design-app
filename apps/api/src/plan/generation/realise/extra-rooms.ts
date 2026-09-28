import {
  geometryOutline,
  polygonArea,
  polygonsIntersect,
  type DesiredFeature,
  type DesignElement,
  type FunctionalZoneType,
  type GardenBrief,
  type GardenZone,
  type HouseFootprint,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import {
  FEATURE_SPECS,
  REPEATABLE_FEATURES,
  featureLabel,
  scaledSpec,
  type FeatureSpec,
} from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import { withinRing } from '../design/circulation.js';
import { BAY_MARGIN } from '../design/composition/compose.js';
import { roomSpec } from '../knowledge/feature-library.js';
import { fitInSlot, type Footprint } from '../layout/fit.js';
import { sideReturn, type DesignFrame } from '../layout/frame.js';
import { RESERVED_SEATS, SUN_SEAT, type LayoutSketch } from '../layout/sketch.js';
import { passageStrip, sideRoomRect, type ZoneRole } from '../layout/zone-roles.js';
import { roomSurface, wantsLoungeRoom } from '../room-policy.js';
import { placeable } from './placeable.js';

/**
 * The least a room beside the house may be. A pair of chairs and a small table, which is what a
 * side lounge is for — smaller than the terrace's floor, because this is a second sitting place
 * rather than the one the house opens onto.
 */
const SIDE_ROOM_FLOOR = { width: 2.4, depth: 2.4 };

export interface ExtraRoomsContext {
  /** The composed sketch and the room it was drawn in, or `null` where there was nothing to compose round. */
  sketch: LayoutSketch | null;
  grammar: { frame: DesignFrame; room: Point[] } | null;
  house: HouseFootprint | null;
  houseRing: Point[] | null;
  boundary: Point[];
  scopePolygon: Point[] | null;
  terrace: DesignElement | null;
  /** What has been built so far, grown by every room placed here. */
  featureLayer: DesignElement[];
  /** What a room must clear, grown by every room placed here. */
  obstacles: Point[][];
  /** Which element each of the composition's slots ended up holding. */
  placedBySlot: Map<string, DesignElement>;
  /** Rooms a path from the house should reach, where there was nothing to compose round. */
  destinations: { outline: Point[]; name: string; primary: boolean }[];
  zones: GardenZone[];
  roles: Map<ZoneId, ZoneRole>;
  brief: GardenBrief;
  requested: DesiredFeature[];
  /** The features the brief asked for that are placed rather than composed, in priority order. */
  toPlace: DesiredFeature[];
  /** How many placements the plot's size allows, of which the surplus becomes second helpings. */
  attempts: number;
  /** The room the concept is organised around, which a second helping is sized for. */
  primaryZone: FunctionalZoneType | undefined;
  constraints: DesignConstraints;
  index: number;
  hostFor: (
    feature: DesiredFeature,
    spec: FeatureSpec,
    geometry: PlanGeometry,
    name: string,
    materialIndex: number,
    purpose?: string,
  ) => DesignElement;
  /** Furnish a host with the given choice index, onto the feature layer and the obstacles. */
  furnish: (host: DesignElement, feature: DesiredFeature, index: number) => void;
  /** The sampler, for a plot with nothing to compose round. */
  place: (spec: FeatureSpec) => Promise<{ geometry: PlanGeometry; zone: ZoneId } | null>;
  zoneOf: (ring: Point[]) => ZoneId;
}

/**
 * The rooms beyond what the brief asked for, once each requested feature has its place: the seats
 * the composition reserved (a garden seat at the far end, a sun terrace), a second helping of a
 * repeatable feature where the plot has room for one, a lounge in a side return wide enough to be a
 * room, and the garden lounge the composition kept a spare bay for. In that order, so nothing takes
 * a bay the composition kept for a seat.
 */
export async function layExtraRooms(context: ExtraRoomsContext): Promise<void> {
  const {
    sketch,
    grammar,
    house,
    houseRing,
    boundary,
    scopePolygon,
    terrace,
    featureLayer,
    obstacles,
    placedBySlot,
    destinations,
    zones,
    roles,
    brief,
    requested,
    toPlace,
    attempts,
    primaryZone,
    constraints,
    index,
    hostFor,
    furnish,
    place,
    zoneOf,
  } = context;

  /*
   * ---- the seats the composition reserved: at the far end, and in the sun ----
   *
   * Before the second helpings, so nothing else takes a bay the composition kept for a seat. The
   * garden seat is a destination garden's far end where nothing asked for was worth walking to;
   * the sun terrace is where the composition found the terrace it drew in the afternoon shade and
   * put a second seat in the light.
   */
  if (sketch && grammar) {
    for (const slot of sketch.slots.filter(
      (candidate) =>
        RESERVED_SEATS.includes(candidate.purpose ?? '') && !placedBySlot.has(candidate.id),
    )) {
      const name = slot.purpose === SUN_SEAT ? 'Sun terrace' : 'Garden seat';
      /*
       * The nook the composition sized, fitted as drawn rather than grown back into a patio — and
       * in the plan's own language: round beside a sweeping lawn, where a paved rectangle is the
       * contradiction the geometry principle exists to report.
       */
      const across = slot.maxSize.width - 2 * BAY_MARGIN;
      const deep = slot.maxSize.depth - 2 * BAY_MARGIN;
      const nook: Footprint =
        sketch.composed.language === 'soft_organic'
          ? { kind: 'point', radius: Math.min(across, deep) / 2 }
          : { kind: 'rect', width: across, depth: deep };
      const fitted = fitInSlot(nook, slot, {
        frame: grammar.frame,
        room: grammar.room,
        houseRing,
        boundary,
        obstacles,
      });
      if (!fitted) continue;
      obstacles.push(geometryOutline(fitted));
      /*
       * Paved in the terrace's own material: it is a second place to sit off the same house, and
       * a new paving for it made the sun terrace the fourth or fifth surface in plans already over
       * the style's limit.
       */
      const host = {
        ...hostFor('seating', FEATURE_SPECS.seating, fitted, name, index + 1, slot.purpose),
        ...(terrace?.material
          ? { material: terrace.material }
          : roomSurface('lounge', constraints, index)),
      };
      featureLayer.push(host);
      placedBySlot.set(slot.id, host);
      furnish(host, 'seating', index + 1);
    }
  }

  /*
   * ---- a second helping, where the plot has room for one ----
   *
   * `featureAttempts` can exceed the requested list on a large plot, and that surplus has to
   * become *more garden* rather than nothing. Only some features repeat sensibly — a second
   * seating area on a big plot is ordinary, a second shed is a mistake — so `REPEATABLE_FEATURES`
   * is a list rather than a rule. Repeats do not go on `checks`: that list answers "did the brief
   * get what it asked for", and it was asked for once.
   */
  let surplus = attempts - toPlace.length;

  for (const feature of toPlace) {
    if (surplus <= 0 || zones.length === 0) break;
    if (!REPEATABLE_FEATURES.includes(feature)) continue;

    const spec = scaledSpec(roomSpec(feature, sketch?.composed.language, primaryZone), constraints);
    /*
     * A second helping goes in a spare room the composition reserved for it — one of the bays whose
     * zone is `lounge` — rather than wherever the sampler finds ground. Only a plot with nothing to
     * compose round samples for one.
     */
    const spare = sketch
      ? sketch.slots.find((slot) => slot.zoneId === 'lounge' && !placedBySlot.has(slot.id))
      : undefined;
    const fitted =
      spare && grammar
        ? fitInSlot(footprintOf(spec), spare, {
            frame: grammar.frame,
            room: grammar.room,
            houseRing,
            boundary,
            obstacles,
          })
        : null;
    const placed = sketch
      ? fitted
        ? {
            geometry: fitted,
            zone: zoneOf(geometryOutline(fitted)),
          }
        : null
      : await place(spec);
    if (!placed) continue;

    obstacles.push(geometryOutline(placed.geometry));
    const host = hostFor(
      feature,
      spec,
      placed.geometry,
      `Second ${(spec.planName ?? featureLabel(feature, brief)).toLowerCase()}`,
      index + 1,
      spare ? (spare.purpose ?? 'lounge') : undefined,
    );
    featureLayer.push(host);
    if (spare) placedBySlot.set(spare.id, host);
    // The second helping gets the *next* choice, so two patios do not carry the same set.
    furnish(host, feature, index + 1);

    surplus -= 1;
  }

  /*
   * ---- the sides: a room where a side is wide enough to be one ----
   *
   * A side return that is only ever base ground and a fence bed is the other half of "grass all
   * round the house". Where there is genuinely room beside the house — after the way past it is
   * taken out — the side gets a room of its own: a lounge deck on a passage's paved strip, a
   * seating room in a secondary side. `sideRoomRect` decides whether there is room; the usual
   * `geometryIsLegal` and obstacle checks decide whether it may go there.
   *
   * Gated on the brief asking for seating and on the budget, because a second sitting room is a
   * thing a garden can want rather than a thing every garden needs — and one per plan, so a plot
   * with two wide sides gets a room and a way past rather than two rooms.
   */
  if (
    house &&
    requested.includes('seating') &&
    constraints.budget !== 'low' &&
    !featureLayer.some((element) => element.name === 'Side lounge')
  ) {
    for (const zone of zones) {
      const role = roles.get(zone.id);
      if (role !== 'passage' && role !== 'secondary') continue;

      const strip =
        role === 'passage'
          ? passageStrip(zone, house)
          : sideReturn(boundary, house, zone.id === 'right' ? 'right' : 'left');
      if (!strip || strip.length < 3 || polygonArea(strip) < 12) continue;

      const rect = sideRoomRect(strip, house, SIDE_ROOM_FLOOR);
      if (!rect) continue;
      const shape: PlanGeometry = { kind: 'rect', ...rect };
      const outline = geometryOutline(shape);
      if (
        !withinRing(outline, strip) ||
        !placeable(shape, houseRing, boundary, scopePolygon) ||
        obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))
      )
        continue;

      const host = hostFor(
        'seating',
        FEATURE_SPECS.seating,
        shape,
        'Side lounge',
        index + 1,
        'lounge',
      );
      Object.assign(host, roomSurface('lounge', constraints, index));
      featureLayer.push(host);
      obstacles.push(outline);
      furnish(host, 'seating', index + 1);
      destinations.push({ outline, name: host.name!, primary: false });
      break;
    }
  }

  if (
    sketch &&
    grammar &&
    terrace &&
    wantsLoungeRoom(requested, constraints) &&
    !featureLayer.some((element) => element.name === 'Side garden retreat')
  ) {
    /*
     * ---- the garden lounge, where the plot asks for one and the composition kept a bay for it ----
     */
    const slot = sketch.slots.find(
      (candidate) => !placedBySlot.has(candidate.id) && candidate.zoneId === 'lounge',
    );
    if (slot) {
      const shape = fitInSlot({ kind: 'rect', width: 3.8, depth: 3.4 }, slot, {
        frame: grammar.frame,
        room: grammar.room,
        houseRing,
        boundary,
        obstacles,
      });
      if (shape?.kind === 'rect' && shape.width >= 3 && shape.depth >= 2.8) {
        const host = {
          ...hostFor('seating', FEATURE_SPECS.seating, shape, 'Garden lounge', index, 'lounge'),
          ...roomSurface('lounge', constraints, index),
        };
        featureLayer.push(host);
        obstacles.push(geometryOutline(shape));
        placedBySlot.set(slot.id, host);
        furnish(host, 'seating', 0);
      }
    }
  }
}

/** A spec's footprint, as the fitter wants it. */
export function footprintOf(spec: FeatureSpec): Footprint {
  return spec.footprint.kind === 'point'
    ? { kind: 'point', radius: spec.footprint.radius }
    : { kind: 'rect', width: spec.footprint.width, depth: spec.footprint.depth };
}
