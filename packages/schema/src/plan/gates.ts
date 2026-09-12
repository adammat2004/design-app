import {
  clipToHalfPlane,
  directionFromDegrees,
  edgeLength,
  midpoint,
  pointInPolygon,
  polygonArea,
  type Point,
} from '../geometry/primitives.js';
import {
  carryOntoSegment,
  clampOffset,
  offsetAfterSplit,
  spanFits,
  spanOnSegment,
  spansOverlap,
} from './along-edge.js';
import type { PlanGeometry } from './features.js';
import { GATE_DEFAULT_WIDTH, type Gate, type GateKind } from './gate.js';
import { OPENING_DEFAULTS, type Opening } from './opening.js';
import {
  firstFreeOffset,
  primaryDoorTowards,
  suggestedWallTowards,
  wallLength,
} from './openings.js';
import {
  boundaryEdgeByVertexId,
  boundaryPolygon,
  houseSize,
  type HouseFootprint,
  type SiteSection,
} from './site.js';

/**
 * Where a gate actually is, and which fence faces the street.
 *
 * The boundary-edge twin of `openings.ts`, and it follows the same two rules. Everything resolves
 * through `boundaryPolygon`, so a dragged corner moves the gate with its fence and nothing has to
 * be updated. And **every resolver returns `null` rather than guessing**: a vertex that has been
 * deleted, or a gate that overruns an edge a drag has shortened, is a state the model can reach,
 * and a gate drawn in mid-air is worse than one the caller skips.
 */

/** What the resolvers need of the site. Narrow so a draft, a document or a fixture all fit. */
export type SiteForGates = Pick<SiteSection, 'vertices' | 'gates' | 'streetEdgeVertexId' | 'house'>;

const MIN_EDGE_LENGTH = 1e-6;
const NORMAL_PROBE = 1e-3;

/** The edge a gate is on, in world coordinates. */
export function gateEdge(site: SiteForGates, gate: Gate): [Point, Point] | null {
  return edgeByVertexId(site, gate.edgeVertexId);
}

function edgeByVertexId(site: SiteForGates, vertexId: string): [Point, Point] | null {
  const edge = boundaryEdgeByVertexId(site, vertexId);
  if (!edge) return null;

  return edgeLength(edge.start, edge.end) < MIN_EDGE_LENGTH ? null : [edge.start, edge.end];
}

/** The gate's own two ends along its edge, or `null` if it no longer fits on it. */
export function gateSegment(site: SiteForGates, gate: Gate): [Point, Point] | null {
  const edge = gateEdge(site, gate);
  if (!edge) return null;

  return spanOnSegment(edge, gate.offsetAlongEdge, gate.width);
}

export function gateCentre(site: SiteForGates, gate: Gate): Point | null {
  const segment = gateSegment(site, gate);
  return segment ? midpoint(segment[0], segment[1]) : null;
}

/**
 * The unit vector pointing **into** the garden through this gate.
 *
 * Inward rather than outward — the opposite of `openingNormal` — because everything that uses it
 * (the side path, the keep-clear threshold, the utility corner) is on the garden side. Decided by
 * probing rather than by winding, for the reason `openingNormal` gives: a hand-drawn outline may
 * run either way, and a normal that is silently outward puts the side path in next door's garden.
 */
export function gateNormal(site: SiteForGates, gate: Gate): Point | null {
  const edge = gateEdge(site, gate);
  if (!edge) return null;

  return inwardNormal(edge, boundaryPolygon(site));
}

/**
 * The unit vector pointing into the garden across this side, or `null` for a side that does not
 * resolve. What a side editor needs to say which way a side faces without inventing a gate on it.
 */
export function edgeInwardNormal(site: SiteForGates, edgeVertexId: string): Point | null {
  const edge = edgeByVertexId(site, edgeVertexId);
  return edge ? inwardNormal(edge, boundaryPolygon(site)) : null;
}

function inwardNormal(edge: [Point, Point], boundary: Point[]): Point | null {
  if (boundary.length < 3) return null;

  const [start, end] = edge;
  const length = edgeLength(start, end);
  const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };

  const candidate = { x: -along.y, y: along.x };
  const mid = midpoint(start, end);
  const probe = { x: mid.x + candidate.x * NORMAL_PROBE, y: mid.y + candidate.y * NORMAL_PROBE };

  return pointInPolygon(probe, boundary) ? candidate : { x: -candidate.x, y: -candidate.y };
}

/**
 * The keep-clear rectangle inside a gate: as wide as the gate, `depth` metres into the garden.
 * Same shape and same conventions as `thresholdRect`, so it flows into the placer's obstacles.
 */
export function gateThresholdRect(
  site: SiteForGates,
  gate: Gate,
  depth: number,
): PlanGeometry | null {
  if (!(depth > 0)) return null;

  const segment = gateSegment(site, gate);
  const normal = gateNormal(site, gate);
  if (!segment || !normal) return null;

  const mid = midpoint(segment[0], segment[1]);
  const along = { x: segment[1].x - segment[0].x, y: segment[1].y - segment[0].y };

  return {
    kind: 'rect',
    centre: { x: mid.x + normal.x * (depth / 2), y: mid.y + normal.y * (depth / 2) },
    width: gate.width,
    depth,
    rotation: (Math.atan2(along.y, along.x) * 180) / Math.PI,
  };
}

/* ---------------------------------------------------------------- what fits where */

export function gatesOnEdge(site: SiteForGates, edgeVertexId: string): Gate[] {
  return site.gates.filter((gate) => gate.edgeVertexId === edgeVertexId);
}

function gateSpan(gate: Gate): [number, number] {
  const half = gate.width / 2;
  return [gate.offsetAlongEdge - half, gate.offsetAlongEdge + half];
}

/** Wholly on its edge, and not through another gate. Touching is fine; sharing width is not. */
export function fitsOnEdge(site: SiteForGates, candidate: Gate): boolean {
  const edge = gateEdge(site, candidate);
  if (!edge) return false;

  const length = edgeLength(edge[0], edge[1]);
  if (!spanFits(length, candidate.offsetAlongEdge, candidate.width)) return false;

  const span = gateSpan(candidate);
  return gatesOnEdge(site, candidate.edgeVertexId)
    .filter((other) => other.id !== candidate.id)
    .every((other) => !spansOverlap(span, gateSpan(other)));
}

/** The nearest offset that keeps a gate of this width wholly on the edge. */
export function clampOffsetToEdge(
  site: SiteForGates,
  edgeVertexId: string,
  width: number,
  desired: number,
): number | null {
  const edge = edgeByVertexId(site, edgeVertexId);
  if (!edge) return null;

  return clampOffset(edgeLength(edge[0], edge[1]), width, desired);
}

/**
 * Somewhere on this edge a gate of this width will fit, preferring the centre, then the gaps
 * between what is already there. The boundary twin of `firstFreeOffset`, and `null` for the same
 * reason: an edge with no room is reported, not quietly given a gate through another gate.
 */
export function firstFreeOffsetOnEdge(
  site: SiteForGates,
  edgeVertexId: string,
  candidate: Gate,
): number | null {
  const edge = edgeByVertexId(site, edgeVertexId);
  if (!edge) return null;

  const length = edgeLength(edge[0], edge[1]);
  if (candidate.width > length) return null;

  const half = candidate.width / 2;
  const occupied = gatesOnEdge(site, edgeVertexId)
    .filter((other) => other.id !== candidate.id)
    .map(gateSpan)
    .sort((a, b) => a[0] - b[0]);

  const offers = [length / 2];
  let cursor = 0;
  for (const [, to] of occupied) {
    offers.push(cursor + half);
    cursor = Math.max(cursor, to);
  }
  offers.push(cursor + half, length - half);

  for (const offer of offers) {
    const placed = { ...candidate, edgeVertexId, offsetAlongEdge: offer };
    if (fitsOnEdge(site, placed)) return offer;
  }

  return null;
}

/* ---------------------------------------------------------------- when the edge changes */

/**
 * The gates after their edge is cut in two by a new corner.
 *
 * `site` is the site *after* the insert — the new vertex is in it — and `firstHalf` is how far
 * along the old edge the cut fell. A gate beyond the cut moves to the new edge with its offset
 * measured from the new corner; one before it stays. Either is then clamped onto its half, so a
 * gate the cut ran through is nudged whole onto one side rather than left straddling a corner.
 * A gate wider than its half is left where the clamp puts it and simply stops resolving.
 */
export function gatesAfterSplit(
  site: SiteForGates,
  edgeVertexId: string,
  insertedVertexId: string,
  firstHalf: number,
): Gate[] {
  return site.gates.map((gate) => {
    if (gate.edgeVertexId !== edgeVertexId) return gate;

    const split = offsetAfterSplit(gate.offsetAlongEdge, firstHalf);
    const home = split.half === 'second' ? insertedVertexId : edgeVertexId;
    const offsetAlongEdge = clampOffsetToEdge(site, home, gate.width, split.offset) ?? split.offset;

    return { ...gate, edgeVertexId: home, offsetAlongEdge };
  });
}

/**
 * The gates and the street edge after a corner is removed and the two edges either side of it
 * become one.
 *
 * `before` and `after` are the site with and without the corner. The edge that started at the
 * deleted corner is gone; the edge that started at the corner *before* it now runs on to the
 * corner after. Anything on the vanished edge is carried onto that merged edge where the merged
 * edge actually passes through it — which is every time the deleted corner was a redundant one on
 * a straight side — and dropped where it does not, because a gate that was on a real bend has no
 * honest place on the straight line that replaced it.
 *
 * Gates already on the surviving edge keep their offsets from its start, which has not moved.
 */
export function accessAfterDelete(
  before: SiteForGates,
  after: SiteForGates,
  deletedVertexId: string,
): { gates: Gate[]; streetEdgeVertexId: string | null } {
  const index = before.vertices.findIndex((vertex) => vertex.id === deletedVertexId);
  const previous = before.vertices[(index - 1 + before.vertices.length) % before.vertices.length];
  const merged = previous ? edgeByVertexId(after, previous.id) : null;

  const gates: Gate[] = after.gates.filter((gate) => gate.edgeVertexId !== deletedVertexId);
  if (index >= 0 && previous && merged) {
    for (const gate of before.gates) {
      if (gate.edgeVertexId !== deletedVertexId) continue;

      const centre = gateCentre(before, gate);
      const offset = centre ? carryOntoSegment(centre, merged, gate.width) : null;
      if (offset === null) continue;

      const carried = { ...gate, edgeVertexId: previous.id, offsetAlongEdge: offset };
      if (fitsOnEdge({ ...after, gates }, carried)) gates.push(carried);
    }
  }

  let streetEdgeVertexId = before.streetEdgeVertexId;
  if (streetEdgeVertexId === deletedVertexId) {
    const old = edgeByVertexId(before, deletedVertexId);
    const foot = old && merged ? carryOntoSegment(midpoint(old[0], old[1]), merged, 0) : null;
    streetEdgeVertexId = foot === null || !previous ? null : previous.id;
  }

  return { gates, streetEdgeVertexId };
}

/* ---------------------------------------------------------------- the street */

/** The fence that faces the street, or `null` when the user has not said. */
export function streetEdge(site: SiteForGates): [Point, Point] | null {
  if (!site.streetEdgeVertexId) return null;
  return edgeByVertexId(site, site.streetEdgeVertexId);
}

/** The direction out of the plot through the street edge, or `null`. */
export function streetOutward(site: SiteForGates): Point | null {
  const edge = streetEdge(site);
  if (!edge) return null;

  const inward = inwardNormal(edge, boundaryPolygon(site));
  return inward ? { x: -inward.x, y: -inward.y } : null;
}

/**
 * The boundary edge most likely to face the street: the one whose outward normal best matches
 * the house's front — bearing 90 before rotation, the same convention `computeZones` uses for the
 * front garden — and which lies in front of the house. Offered, not applied, like the patio door.
 */
export function suggestedStreetEdge(site: SiteForGates): string | null {
  const { house } = site;
  if (!house) return null;

  const boundary = boundaryPolygon(site);
  if (boundary.length < 3) return null;

  const front = directionFromDegrees(90 + house.rotation);
  let best: { id: string; alignment: number; length: number } | null = null;

  for (const vertex of site.vertices) {
    const edge = edgeByVertexId(site, vertex.id);
    if (!edge) continue;

    const inward = inwardNormal(edge, boundary);
    if (!inward) continue;

    const outward = { x: -inward.x, y: -inward.y };
    const mid = midpoint(edge[0], edge[1]);
    const ahead = (mid.x - house.centre.x) * front.x + (mid.y - house.centre.y) * front.y;
    if (ahead <= 0) continue;

    const alignment = outward.x * front.x + outward.y * front.y;
    const length = edgeLength(edge[0], edge[1]);
    const better =
      !best ||
      alignment > best.alignment + 1e-9 ||
      (Math.abs(alignment - best.alignment) < 1e-9 && length > best.length);

    if (better) best = { id: vertex.id, alignment, length };
  }

  return best?.id ?? null;
}

/**
 * The way the garden lies: away from the street when the user has said where that is, else
 * towards whichever of the house's four walls has the most plot beyond it.
 *
 * The zone convention — "the back is bearing 270 before rotation" — is a fact about how the
 * house was *drawn*, and a house dropped near the top of a plot puts its convention-back against
 * the fence with the whole garden in front. The street edge settles it honestly; until it is
 * stated, the biggest side is the garden, which is what anyone looking at the plan would say.
 */
export function gardenDirection(site: SiteForGates): Point | null {
  const { house } = site;
  if (!house) return null;

  const outward = streetOutward(site);
  if (outward) return { x: -outward.x, y: -outward.y };

  const boundary = boundaryPolygon(site);
  if (boundary.length < 3) return directionFromDegrees(270 + house.rotation);

  const { width, depth } = houseSize(house);
  let best: { direction: Point; area: number } | null = null;

  for (const bearing of [270, 90, 0, 180]) {
    const direction = directionFromDegrees(bearing + house.rotation);
    const reach = bearing % 180 === 0 ? width / 2 : depth / 2;
    const beyond = clipToHalfPlane(
      boundary,
      { x: house.centre.x + direction.x * reach, y: house.centre.y + direction.y * reach },
      direction,
    );
    const area = polygonArea(beyond);
    if (!best || area > best.area + 1e-9) best = { direction, area };
  }

  return best?.direction ?? directionFromDegrees(270 + house.rotation);
}

/** The way the street lies: through the street edge when known, else opposite the garden. */
export function streetDirection(site: SiteForGates): Point | null {
  const { house } = site;
  if (!house) return null;

  const outward = streetOutward(site);
  if (outward) return outward;

  const garden = gardenDirection(site);
  return garden ? { x: -garden.x, y: -garden.y } : null;
}

/* ---------------------------------------------------------------- the side gate */

/**
 * Where a side gate most likely is: on a side fence, beside the house, on the wider of the two
 * returns — which is where a passage a wheelie bin fits down actually runs — and just behind the
 * house's back wall, where a side gate is hung so the front garden stays public and the back
 * private. `null` when there is no house or no side fence.
 */
export function suggestedGateEdge(
  site: SiteForGates,
): { edgeVertexId: string; offsetAlongEdge: number } | null {
  const { house } = site;
  if (!house) return null;

  const boundary = boundaryPolygon(site);
  if (boundary.length < 3) return null;

  // Towards the street when the user has said where it is; the house's own front otherwise.
  const front = streetOutward(site) ?? directionFromDegrees(90 + house.rotation);
  const right = { x: -front.y, y: front.x };
  const { width, depth } = houseSize(house);

  let best: { id: string; edge: [Point, Point]; clearance: number } | null = null;

  for (const vertex of site.vertices) {
    const edge = edgeByVertexId(site, vertex.id);
    if (!edge) continue;

    const inward = inwardNormal(edge, boundary);
    if (!inward) continue;

    // A side fence runs roughly along the house's depth axis: its normal is across the house.
    if (Math.abs(inward.x * front.x + inward.y * front.y) > 0.5) continue;

    const mid = midpoint(edge[0], edge[1]);
    const across = (mid.x - house.centre.x) * right.x + (mid.y - house.centre.y) * right.y;
    const clearance = Math.abs(across) - width / 2;
    if (clearance <= 0) continue;

    if (!best || clearance > best.clearance) best = { id: vertex.id, edge, clearance };
  }

  if (!best) return null;

  // A metre behind the back wall, projected onto the fence and kept wholly on it.
  const back = { x: -front.x, y: -front.y };
  const hinge = {
    x: house.centre.x + back.x * (depth / 2 + 1),
    y: house.centre.y + back.y * (depth / 2 + 1),
  };
  const [start, end] = best.edge;
  const length = edgeLength(start, end);
  const t =
    ((hinge.x - start.x) * (end.x - start.x) + (hinge.y - start.y) * (end.y - start.y)) / length;

  const offset = clampOffsetToEdge(site, best.id, GATE_DEFAULT_WIDTH, t);
  return offset === null ? null : { edgeVertexId: best.id, offsetAlongEdge: offset };
}

/** Which side of the house a gate is on, in the house's own frame. */
export function gateSide(
  site: SiteForGates,
  gate: Gate,
  house: HouseFootprint,
): 'left' | 'right' | null {
  const centre = gateCentre(site, gate);
  if (!centre) return null;

  const right = directionFromDegrees(house.rotation);
  const across = (centre.x - house.centre.x) * right.x + (centre.y - house.centre.y) * right.y;
  return across >= 0 ? 'right' : 'left';
}

/** A gate that resolves, with everything a caller needs to draw it or design from it. */
export interface ResolvedGate {
  gate: Gate;
  segment: [Point, Point];
  centre: Point;
  inward: Point;
}

/** Every gate that currently resolves, with its centre and inward normal. */
export function resolvedGates(site: SiteForGates): ResolvedGate[] {
  const out: ResolvedGate[] = [];
  for (const gate of site.gates) {
    const segment = gateSegment(site, gate);
    const inward = gateNormal(site, gate);
    if (!segment || !inward) continue;
    out.push({ gate, segment, centre: midpoint(segment[0], segment[1]), inward });
  }
  return out;
}

/**
 * Which opening a side path should start at, or `null` when none should.
 *
 * The generator used to take `resolvedGates(site)[0]` — whichever gate happened to be stored
 * first — and route the garden's side path from it. That was fine while every gate was a 900 mm
 * pedestrian one, and it is wrong now that a gap in the boundary can be a driveway or an open
 * frontage:
 *
 * - **Nothing on the street edge.** A gate in the street frontage is the *front* garden's
 *   business, and `front.ts` already runs a path to the kerb. Starting the back garden's side path
 *   there drags it through the front garden and past the house.
 * - **A pedestrian gate first.** It is what a side path is for: the bins, the mower, a person
 *   carrying something in. A driveway is where a car stands, which is why it gets the deeper
 *   keep-clear rather than a footpath.
 * - **But a driveway off the street will do** if it is the only way in, because you can walk
 *   through one; it is simply the last choice.
 *
 * `open` counts as walk-through: a gap with nothing hung in it is still how you get through.
 */
const GATE_PREFERENCE: Record<GateKind, number> = { pedestrian: 0, open: 1, vehicle: 2 };

export function sidePathGate(site: SiteForGates): ResolvedGate | null {
  const street = site.streetEdgeVertexId;

  const candidates = resolvedGates(site).filter(
    (entry) => street === null || entry.gate.edgeVertexId !== street,
  );

  let best: ResolvedGate | null = null;
  for (const entry of candidates) {
    if (!best || GATE_PREFERENCE[entry.gate.kind] < GATE_PREFERENCE[best.gate.kind]) best = entry;
  }

  return best;
}

/* ---------------------------------------------------------------- everything at once */

/**
 * The whole of step 1's property detail, inferred: the street in front of the house, patio doors
 * centred on the wall facing away from it, a front door on the wall facing it, and a side gate
 * on the wider return. Returns the site with those added and nothing else touched; anything the
 * user has already placed is kept and only the gaps are filled.
 *
 * This is what a fixture or a capture script wants — a site that reads as a real one — and what a
 * "set it up for me" tap would apply. It is deliberately **not** applied silently anywhere: each
 * inference is offered one chip at a time by `SuggestionsRow`, and everything it covers can also
 * be stated by clicking the side or the wall it is about. Same rule `suggestedDoorWall` gives.
 */
export function suggestedAccess<S extends SiteForGates>(site: S): S {
  const { house } = site;
  if (!house) return site;

  const streetEdgeVertexId = site.streetEdgeVertexId ?? suggestedStreetEdge(site);
  let next: S = { ...site, streetEdgeVertexId };

  const garden = gardenDirection(next);
  const street = streetDirection(next);
  const openings: Opening[] = [...house.openings];
  let ids = openings.length;
  const nextId = () => `o${(ids += 1)}`;

  const addDoor = (facing: Point | null, type: 'patio-door' | 'front-door') => {
    if (!facing || primaryDoorTowards({ ...house, openings }, facing)) return;
    if (type === 'front-door' && openings.some((opening) => opening.type === 'front-door')) return;
    const wallId = suggestedWallTowards({ ...house, openings }, facing, type);
    if (!wallId) return;
    const length = wallLength(house, wallId);
    const defaults = OPENING_DEFAULTS[type];
    if (length === null || length < defaults.width) return;
    const candidate: Opening = { ...defaults, id: nextId(), wallId, offsetAlongEdge: length / 2 };
    const offset = firstFreeOffset({ ...house, openings }, wallId, candidate);
    if (offset === null) return;
    openings.push({ ...candidate, offsetAlongEdge: offset });
  };

  addDoor(garden, 'patio-door');
  addDoor(street, 'front-door');
  next = { ...next, house: { ...house, openings } };

  if (next.gates.length === 0) {
    const gate = suggestedGateEdge(next);
    if (gate) {
      next = {
        ...next,
        gates: [
          {
            id: 'g1',
            edgeVertexId: gate.edgeVertexId,
            offsetAlongEdge: gate.offsetAlongEdge,
            width: GATE_DEFAULT_WIDTH,
            kind: 'pedestrian',
          },
        ],
      };
    }
  }

  return next;
}
