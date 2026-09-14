import {
  boundaryRuns,
  computeZones,
  effectiveZoneIds,
  featureOutline,
  frontDoor,
  gardenDirection,
  gardenDoors,
  housePolygon,
  houseSize,
  lightDirection,
  openingCentre,
  openingNormal,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  primaryDoor,
  projectShadow,
  resolveDesignScope,
  resolvedGates,
  shadowCast,
  shadowOccluders,
  shadowRings,
  sidePathGate,
  streetDirection,
  styleForEdge,
  zoneAt,
  type GardenZone,
  type Opening,
  type PlanDocument,
  type Point,
  type SiteSection,
  type SiteShape,
  type ZoneId,
} from '@garden-studio/schema';
import { resolvePlotScale } from '../constraints.js';
import { backFrame, frontFrame, gardenRoom, localBox, type DesignFrame } from '../layout/frame.js';
import { PASSAGE_MAX_WIDTH, usableWidth, zoneRoles, type ZoneRole } from '../layout/zone-roles.js';
import type { AwkwardArea, ResolvedExit, SiteAnalysis, SiteEdge } from './types.js';

/**
 * What the site implies for the design, read once and deterministically.
 *
 * Everything here already existed, scattered through `build()` and re-derived a second time in the
 * fixture test's own helpers — the frame, the room, the zone roles, which gate a side path starts
 * at, which zone the grammar composes in. Gathering it is not tidiness: a design agent that reasons
 * about a site needs one answer to "what is this plot like", and two call sites computing it
 * separately is exactly how the badge and the palette once came to disagree about maintenance.
 *
 * **Pure and query-free.** The scope-clipped zones and rooms are PostGIS results and arrive
 * separately on a generation context; what is here is true of the plot whatever the user ticked.
 * That split is also what lets the fixture test and the eval script analyse a document with no
 * database running.
 *
 * Nothing is inferred that the document does not support. There is no shade without a location, no
 * neighbour behind a boundary the user never described, and no primary exit when no door resolves.
 */

/**
 * How wide the primary sightline is, each side of straight ahead.
 *
 * Not the field of vision — that is most of a hemisphere and would put every corner of every garden
 * "in view", which is useless for deciding where a shed may go. This is the wedge you are *looking
 * at* when you stand in the doorway: fifteen degrees each side, and capped below so it never covers
 * more than half the width of the room. On a fifteen-metre garden an uncapped thirty-degree cone
 * reaches seventeen metres across at the far fence, which is wider than the plot.
 */
const VIEW_CONE_DEGREES = 15;

/** The most of the room's width the sightline may claim, however deep the garden is. */
const VIEW_CONE_MAX_SHARE = 0.5;

/** Beyond this ratio of depth to width a room is long rather than square; the reciprocal is wide. */
const SHAPE_RATIO = 1.6;

/** A room this much longer than it is wide is emphatically linear: a corridor garden. */
const STRONG_RATIO = 2.6;

/** How much of its own local bounding box a room must fill before it counts as a regular shape. */
const REGULAR_SHARE = 0.82;

/** Midsummer mid-afternoon: the hour a garden is used, and the one seating is judged against. */
const AFTERNOON = { dayOfYear: 172, minutes: 15 * 60 };

export function analyseSite(document: PlanDocument): SiteAnalysis {
  const site = document.site;
  const house = site.house;
  const boundary = site.vertices.map(({ x, y }) => ({ x, y }));
  const plotArea = boundary.length >= 3 ? polygonArea(boundary) : 0;

  const zones = computeZones(boundary, house);
  const scope = resolveDesignScope(site, zones);
  const ticked = effectiveZoneIds(site.selectedZoneIds, zones);
  /* No ticks at all means the whole garden, exactly as `build` reads it. */
  const inScope = ticked.length > 0 ? ticked : zones.map((zone) => zone.id);

  const garden = gardenDirection(site);
  const frame = house && garden ? backFrame(house, garden) : null;
  const room = frame && house ? nonEmpty(gardenRoom(boundary, house, frame, inScope)) : null;
  const box = room && frame ? localBox(room, frame) : null;

  const street = streetDirection(site);
  const front = house && street ? frontFrame(house, street) : null;
  const frontRoom = front && house ? nonEmpty(gardenRoom(boundary, house, front, inScope)) : null;

  const mainZoneId = room ? (zoneAt(polygonCentroid(room), zones)?.id ?? null) : null;
  const frontZoneId = frontRoom ? (zoneAt(polygonCentroid(frontRoom), zones)?.id ?? null) : null;
  const roles = zoneRoles(zones, { house, roomZoneId: mainZoneId, frontZoneId });

  const usableWidths = new Map<ZoneId, number | null>(
    zones.map((zone) => [zone.id, house ? usableWidth(zone, house) : null]),
  );

  const roomDepth = box ? box.uMax : null;
  const roomWidth = box ? box.vMax - box.vMin : null;

  const designedArea = zones
    .filter((zone) => inScope.includes(zone.id))
    .reduce((total, zone) => total + zone.area, 0);

  const sideGate = sidePathGate(site);

  return {
    boundary,
    plotArea,
    scale: resolvePlotScale(designedArea),
    house: house
      ? {
          ring: housePolygon(house),
          centre: house.centre,
          rotation: house.rotation ?? 0,
          storeys: house.storeys ?? 2,
          ...houseSize(house),
        }
      : null,
    frame,
    room,
    box,
    frontFrame: front,
    frontRoom,
    shape: siteShape(room, roomDepth, roomWidth),
    roomDepth,
    roomWidth,
    zones,
    roles,
    usableWidths,
    mainZoneId,
    frontZoneId,
    scope,
    exits: resolveExits(site),
    gates: resolvedGates(site),
    sideGate,
    gateSide: sideGate && frame ? (frame.toLocal(sideGate.centre).v >= 0 ? 'right' : 'left') : null,
    edges: siteEdges(site, frame),
    primaryAxis: primaryAxis(frame, box),
    viewCone: viewCone(frame, box),
    retained: document.features.features
      .filter((feature) => feature.status === 'keep')
      .map((feature) => ({ feature, ring: featureOutline(feature) })),
    awkward: awkwardAreas(zones, roles, usableWidths, house !== null),
    sun: afternoonShade(document),
  };
}

function nonEmpty(ring: Point[]): Point[] | null {
  return ring.length >= 3 ? ring : null;
}

/* ---------------------------------------------------------------- shape */

/**
 * What shape of space the garden is, measured on the **room** rather than on the plot.
 *
 * Which archetype can work is a fact about the ground behind the doors: a 20 m plot with the house
 * at the front and a 20 m plot with the house in the middle are different gardens, and only the
 * room tells them apart. A room much smaller than its own local bounding box is `irregular`
 * whatever its proportions — an L, a wedge, a plot with a corner taken out — because that is
 * precisely the case where an archetype's rectangles have nowhere to go, which is the open
 * "a concave redesign area makes plans sparser" limitation in TODOS.
 */
export function siteShape(
  room: Point[] | null,
  depth: number | null,
  width: number | null,
): SiteShape {
  if (!room || depth === null || width === null || depth <= 0 || width <= 0) return 'irregular';
  if (polygonArea(room) < REGULAR_SHARE * depth * width) return 'irregular';

  // A courtyard first: it is a size, and a small square room is a courtyard rather than a square.
  if (depth < 5 && width < 8) return 'courtyard';

  const ratio = depth / width;
  if (ratio >= SHAPE_RATIO) return 'long';
  if (ratio <= 1 / SHAPE_RATIO) return 'wide';
  return 'square';
}

/** Whether the room is emphatically linear — what a sequence-of-rooms layout needs to earn its place. */
export function isStronglyLinear(analysis: SiteAnalysis): boolean {
  const { roomDepth, roomWidth } = analysis;
  return (
    roomDepth !== null &&
    roomWidth !== null &&
    roomWidth > 0 &&
    roomDepth / roomWidth >= STRONG_RATIO
  );
}

/* ---------------------------------------------------------------- exits */

function resolveExits(site: SiteSection): SiteAnalysis['exits'] {
  const house = site.house;
  if (!house) return { primary: null, garden: [], front: null };

  const garden = gardenDoors(house)
    .map((door) => resolveExit(site, door))
    .filter((exit): exit is ResolvedExit => exit !== null);

  const fallback = primaryDoor(house);
  const frontOpening = frontDoor(house, streetDirection(site) ?? undefined);

  return {
    /* The widest garden door, else whatever `primaryDoor` picked, else nothing at all. */
    primary: garden[0] ?? (fallback ? resolveExit(site, fallback) : null),
    garden,
    front: frontOpening ? resolveExit(site, frontOpening) : null,
  };
}

function resolveExit(site: SiteSection, opening: Opening): ResolvedExit | null {
  const house = site.house;
  if (!house) return null;
  const centre = openingCentre(house, opening);
  const outward = openingNormal(house, opening);
  // Both return null rather than guessing when a resize has shortened the wall under the door.
  if (!centre || !outward) return null;
  return { opening, centre, outward, width: opening.width };
}

/* ---------------------------------------------------------------- edges */

/**
 * Every side of the property, with what is beyond it.
 *
 * `exposure` is deliberately three-way. The street edge is stated by the user. A side the user
 * described as a wall, fence, hedge or railing has somebody on the other side of it — that is what
 * choosing a boundary treatment *means*. A side nobody has described is `unknown`, and the privacy
 * principle scores nothing against it rather than assuming an overlooking window. The same refusal
 * `site.location` makes about latitude: a plausible guess would have the design built confidently
 * around a fact the user never stated.
 */
export function siteEdges(site: SiteSection, frame: DesignFrame | null): SiteEdge[] {
  const ring = site.vertices.map(({ x, y }) => ({ x, y }));

  return boundaryRuns(site).map((run) => {
    const midpoint = { x: (run.start.x + run.end.x) / 2, y: (run.start.y + run.end.y) / 2 };
    const dx = run.end.x - run.start.x;
    const dy = run.end.y - run.start.y;
    const normal = { x: -dy / run.length, y: dx / run.length };

    return {
      vertexId: run.edgeVertexId,
      start: run.start,
      end: run.end,
      length: run.length,
      inward: facingInward(normal, midpoint, ring),
      exposure:
        site.streetEdgeVertexId === run.edgeVertexId
          ? 'street'
          : styleForEdge(site, run.edgeVertexId)
            ? 'neighbour'
            : 'unknown',
      kind: run.kind,
      height: run.height,
      side: frame ? sideOf(frame, midpoint) : null,
    };
  });
}

/**
 * The normal turned to point into the plot.
 *
 * Probed rather than assumed, exactly as `openingNormal` probes: `rectanglePlotOutline` runs one
 * way and a hand-drawn boundary may run the other, and an "inward" normal that is silently outward
 * puts every privacy measurement on the neighbour's side of the fence.
 */
function facingInward(normal: Point, at: Point, ring: Point[]): Point {
  if (ring.length < 3) return normal;
  const probe = { x: at.x + normal.x * 1e-3, y: at.y + normal.y * 1e-3 };
  return pointInPolygon(probe, ring) ? normal : { x: -normal.x, y: -normal.y };
}

/** Which side of the design frame a point lies on: back, left, right, or in front of the doors. */
function sideOf(frame: DesignFrame, point: Point): SiteEdge['side'] {
  const { u, v } = frame.toLocal(point);
  if (u < 0) return 'front';
  if (Math.abs(v) > u) return v >= 0 ? 'right' : 'left';
  return 'back';
}

/* ---------------------------------------------------------------- axis and view */

/** The line out of the doors to the far end of the room: what a focal point terminates. */
function primaryAxis(
  frame: DesignFrame | null,
  box: SiteAnalysis['box'],
): SiteAnalysis['primaryAxis'] {
  if (!frame || !box || box.uMax <= 0) return null;
  return { from: frame.toWorld(0, 0), to: frame.toWorld(box.uMax, 0) };
}

/**
 * What you see standing in the doorway: a wedge, not a line.
 *
 * Returned as a polygon so visibility is one `pointInPolygon` rather than a pair of angle
 * comparisons repeated at every call site — and so "the shed must not be in the view" and "the play
 * area should be" are the same test read in opposite directions, which is what stops them drifting.
 */
function viewCone(frame: DesignFrame | null, box: SiteAnalysis['box']): Point[] | null {
  if (!frame || !box || box.uMax <= 0) return null;
  const reach = box.uMax;
  const spread = Math.min(
    reach * Math.tan((VIEW_CONE_DEGREES * Math.PI) / 180),
    ((box.vMax - box.vMin) * VIEW_CONE_MAX_SHARE) / 2,
  );
  return [frame.toWorld(0, 0), frame.toWorld(reach, -spread), frame.toWorld(reach, spread)];
}

/* ---------------------------------------------------------------- awkward ground */

/**
 * The parts of the plot the grammar cannot compose in, and why.
 *
 * Derived from the roles and the usable widths rather than measured again: a passage already *is*
 * "narrower than five metres level with the house", and re-deriving that here would be a second
 * source for one fact. With no house at all every zone is awkward, which is the honest answer for a
 * plot the sampler will place everything on.
 */
function awkwardAreas(
  zones: GardenZone[],
  roles: Map<ZoneId, ZoneRole>,
  widths: Map<ZoneId, number | null>,
  hasHouse: boolean,
): AwkwardArea[] {
  const awkward: AwkwardArea[] = [];
  for (const zone of zones) {
    if (!hasHouse) {
      awkward.push({ zone: zone.id, ring: zone.polygon, reason: 'no-house', area: zone.area });
      continue;
    }
    const role = roles.get(zone.id);
    const width = widths.get(zone.id) ?? null;
    if (role === 'passage' && width !== null && width < PASSAGE_MAX_WIDTH) {
      awkward.push({ zone: zone.id, ring: zone.polygon, reason: 'narrow-return', area: zone.area });
    } else if (role === 'remote') {
      awkward.push({ zone: zone.id, ring: zone.polygon, reason: 'beyond-room', area: zone.area });
    }
  }
  return awkward;
}

/* ---------------------------------------------------------------- sun */

/**
 * Where the shade falls at three on a midsummer afternoon, and which way the sun is.
 *
 * `null` without `site.location`, which is the same refusal `shadowCast` makes: shadow length is
 * `height / tan(altitude)` and altitude is a function of latitude, so there is no shade that is
 * true of anywhere. A plan with no location scores nothing on the sun principle and its weight is
 * redistributed, rather than every unlocated garden being marked down for a fact nobody stated.
 *
 * The hour is fixed rather than read from `site.sun`: that field is a *view* preference — "show me
 * half three in June" — and judging a design by whatever time the user last dragged the slider to
 * would make the same garden score differently on two screens.
 *
 * The occluders are the house and whatever is already on the plan. On a fresh document that is the
 * house alone, which is the shadow that decides where the seating goes anyway.
 */
function afternoonShade(document: PlanDocument): SiteAnalysis['sun'] {
  const site = document.site;
  if (!site.location) return null;

  const at: SiteSection = { ...site, sun: AFTERNOON };
  const cast = shadowCast(at);
  const towards = lightDirection(at);
  if (!cast || !towards) return null;

  const shade: Point[][] = [];
  for (const occluder of shadowOccluders(
    document.layout.elements,
    site.house,
    boundaryRuns(site),
  )) {
    const geometry = projectShadow(occluder.outline, occluder.height, cast);
    if (geometry) shade.push(...shadowRings(geometry));
  }

  return { towards, shade };
}
