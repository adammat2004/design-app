import {
  geometryOutline,
  polygonArea,
  polygonCentroid,
  type DesignBrief,
  type DesiredFeature,
  type ElementCategory,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { FEATURE_SPECS, inradius, scaledSpec } from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import type { LayoutArchetype } from '../knowledge/archetypes/types.js';
import { FEATURE_LIBRARY, placementLadder } from '../knowledge/feature-library.js';
import { assignByPriority } from '../layout/assign.js';
import { fitInSlot, type FitContext, type Footprint } from '../layout/fit.js';
import type { DesignFrame, LocalBox } from '../layout/frame.js';
import { rectSize, type LayoutSketch, type Slot, type SketchRequest } from '../layout/sketch.js';
import { circulationFor } from '../room-policy.js';
import { closestPointOnRing, routeBetween, PATH_STANDOFF } from './circulation.js';
import { planZones } from './zone-planner.js';
import {
  NO_ADJUSTMENTS,
  slotBarred,
  type CandidateParams,
  type LayoutAdjustments,
  type SiteAnalysis,
  type ZonePlan,
} from './types.js';

/**
 * What a candidate would draw, worked out without touching the database.
 *
 * **A preview, and deliberately not the plan.** It lays the terrace, fits the requested features
 * into the rooms the zone planner positioned, routes the sketch's own paths, guarantees a way to
 * every room it placed and stands the trees — the whole of what a *composition and its parameters*
 * decide. It does not run the PostGIS sampler for leftovers, cut the beds, compose the front garden
 * or specify the lighting, because none of those distinguish one candidate from another on the same
 * plot: they are realisation, and they run once on the winner.
 *
 * **What it does draw is chosen by what the score can be wrong about.** The access guarantee is here
 * because leaving it out was measurably dishonest: the real pipeline adds those paths, they are the
 * ones that cross planting because nothing composed them, and a candidate was being chosen on a
 * circulation reading its own realisation then contradicted. A pass belongs in the preview when
 * omitting it changes the ranking, not when it changes the picture.
 *
 * That division is the entire reason a candidate loop is affordable. Fifty of these cost a few
 * milliseconds between them; fifty realisations would be a minute of PostGIS. The finalist is then
 * scored again at the `realised` tier over its actual elements, so a preview that flattered itself
 * is caught rather than trusted.
 *
 * Determinism matters as much here as anywhere: the same inputs draw the same preview, so the
 * candidate that wins is the candidate that gets built.
 */

/** Offsets tried for a sketched tree, in frame metres: where it was drawn, then nearby. */
const TREE_NUDGES: [number, number][] = [
  [0, 0],
  [-0.6, 0],
  [0.6, 0],
  [0, -0.6],
  [0, 0.6],
  [-1.2, 0],
  [1.2, 0],
  [0, -1.2],
  [0, 1.2],
  [-1.2, -1.2],
  [1.2, 1.2],
];

/** A drawn canopy's radius, matching the generator's own. */
const TREE_RADIUS = 1.6;

/** What a preview found a place for. */
export interface PlacedItem {
  id: string;
  feature: DesiredFeature;
  zone: string;
  slotId: string;
  geometry: PlanGeometry;
  ring: Point[];
  name: string;
  category: ElementCategory;
}

export interface PreviewRoute {
  id: string;
  name: string;
  geometry: PlanGeometry;
}

export interface LayoutPreview {
  id: string;
  archetype: LayoutArchetype['id'];
  params: CandidateParams;
  zonePlan: ZonePlan;
  sketch: LayoutSketch;
  placed: PlacedItem[];
  routes: PreviewRoute[];
  trees: Point[];
  /** The open panel in world metres, before the fill pass cuts it. */
  lawn: { ring: Point[]; category: 'lawn' | 'gravel-mulch' } | null;
  beds: { name: string; ring: Point[] }[];
  /** Requested features the composition could not seat. Realisation samples for these. */
  unplaced: DesiredFeature[];
  /** The sketch wanted a terrace and nothing legal fitted: the worst thing a candidate can say. */
  terraceRefused: boolean;
}

export interface PreviewRequest {
  archetype: LayoutArchetype;
  params: CandidateParams;
  brief: DesignBrief;
  analysis: SiteAnalysis;
  constraints: DesignConstraints;
  /** The room the grammar composes in, clipped to the redesign area. World metres. */
  room: Point[];
  box: LocalBox;
  frame: DesignFrame;
  boundary: Point[];
  houseRing: Point[] | null;
  scope: Point[] | null;
  /** The house, kept features and every threshold: what a placement must avoid. */
  obstacles: Point[][];
  /** Doorways and gate thresholds, which the terrace alone may sit across. */
  thresholds: Point[][];
  /** The features to place, in priority order, after the capacity cut. */
  placing: DesiredFeature[];
  /** Which zone id a ring's centroid lands in. Supplied so the preview needs no zone list. */
  zoneAt: (ring: Point[]) => ZoneId;
  gateSide: 'left' | 'right' | null;
  gateCentre: Point | null;
  lawnAllowed: boolean;
  /** What the repair stage changed about this candidate. Absent draws the unrepaired plan. */
  adjustments?: LayoutAdjustments;
}

export function previewLayout(request: PreviewRequest): LayoutPreview {
  const { archetype, params, analysis, constraints, frame, box } = request;
  const adjustments = request.adjustments ?? NO_ADJUSTMENTS;
  const placing = request.placing.filter((feature) => !adjustments.dropped.includes(feature));

  const room = {
    uMin: Math.max(0, box.uMin),
    uMax: box.uMax,
    vMin: box.vMin,
    vMax: box.vMax,
    polygon: box.polygon,
  };

  const sketchRequest: SketchRequest = {
    features: placing,
    scale: constraints.scale.sizeFactor,
    style: constraints.style,
    lawnAllowed: request.lawnAllowed,
    gateSide: request.gateSide,
    houseWallLength: frame.wallLength,
    doorWidth: frame.doorWidth,
  };

  const zonePlan = planZones({
    brief: request.brief,
    site: analysis,
    archetype,
    params,
    room,
    request: sketchRequest,
    placing,
  });
  const sketch = archetype.sketch(sketchRequest, room, zonePlan, params);

  /* A copy: a preview must not push onto the caller's obstacle list. */
  const obstacles = [...request.obstacles];
  const context: FitContext = {
    frame,
    room: request.room,
    houseRing: request.houseRing,
    boundary: request.boundary,
    obstacles,
  };

  let counter = 0;
  const nextId = () => `p${(counter += 1)}`;

  const placed: PlacedItem[] = [];
  const routes: PreviewRoute[] = [];
  const filled = new Map<string, PlacedItem>();
  const settled = new Set<DesiredFeature>();
  let terraceRefused = false;

  /* ---- the terrace, which every plan has and which every path starts from ---- */

  const terraceSlot = sketch.slots.find((slot) => slot.kind === 'terrace');
  let terrace: PlacedItem | null = null;

  if (sketch.terrace && terraceSlot) {
    const geometry = fitInSlot({ kind: 'rect', ...rectSize(sketch.terrace) }, terraceSlot, {
      ...context,
      ignore: request.thresholds,
    });
    if (geometry) {
      /*
       * Which of seating and dining claims it matters for the same reason it does in the real
       * pipeline: they are furnished differently, and seating wins when both were asked for.
       */
      const feature: DesiredFeature = placing.includes('seating')
        ? 'seating'
        : placing.includes('dining')
          ? 'dining'
          : 'seating';
      terrace = record(feature, geometry, terraceSlot, nextId());
      placed.push(terrace);
      filled.set(terraceSlot.id, terrace);
      obstacles.push(terrace.ring);
      settled.add(feature);
    } else {
      terraceRefused = true;
    }
  }

  /* ---- the requested features, by priority, into the rooms that claim them ---- */

  const toPlace = placing.filter(
    (feature) => !FEATURE_LIBRARY[feature].composed && !settled.has(feature),
  );
  const assigned = assignByPriority(
    { ...sketch, slots: sketch.slots.filter((slot) => slot.kind !== 'terrace') },
    toPlace,
  );

  const unplaced: DesiredFeature[] = [];
  for (const feature of toPlace) {
    const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
    const entry = assigned.find((candidate) => candidate.feature === feature);
    const candidates = [
      ...sketch.slots.filter((slot) => slot.id === entry?.slotId),
      ...placementLadder(feature).flatMap((kind) =>
        sketch.slots.filter((slot) => slot.kind === kind),
      ),
    ].filter((slot) => !filled.has(slot.id) && !slotBarred(adjustments, feature, slot.id));

    const fitted = candidates
      .map((slot) => ({ slot, geometry: fitInSlot(footprintOf(spec), slot, context) }))
      .find((candidate) => candidate.geometry !== null);

    if (!fitted?.geometry) {
      unplaced.push(feature);
      continue;
    }

    const item = record(feature, fitted.geometry, fitted.slot, nextId());
    placed.push(item);
    filled.set(fitted.slot.id, item);
    obstacles.push(item.ring);
  }

  /* ---- the sketch's own paths ---- */

  /** Which placed rooms already have a way to them, so the guarantee below does not double up. */
  const connected = new Set<string>();

  const widthOf = (metres: number) =>
    adjustments.routeWidth === null ? metres : Math.max(metres, adjustments.routeWidth);

  for (const sketched of sketch.paths) {
    const purpose = 'gate' in sketched.to ? 'access' : 'secondary';
    const route = circulationFor(purpose, constraints);

    let start: Point;
    let destination: Point[];
    let reached: string | null = null;
    const ignore = [...request.thresholds];

    if ('gate' in sketched.to) {
      if (!request.gateCentre || !terrace) continue;
      const inward = inwardFrom(request.gateCentre, request.room);
      start = {
        x: request.gateCentre.x + inward.x * PATH_STANDOFF,
        y: request.gateCentre.y + inward.y * PATH_STANDOFF,
      };
      destination = terrace.ring;
      ignore.push(terrace.ring);
    } else {
      const target = [sketched.to.slot, ...(sketched.to.or ?? [])]
        .map((slot) => filled.get(slot))
        .find((item) => item !== undefined);
      if (!target) continue;
      destination = target.ring;
      reached = target.id;
      ignore.push(destination);
      if (terrace) ignore.push(terrace.ring);
      start =
        'terrace' in sketched.from
          ? terrace
            ? closestPointOnRing(terrace.ring, polygonCentroid(destination), 0)
            : frame.toWorld(0, 0)
          : frame.toWorld(sketched.from.u, sketched.from.v);
    }

    const via = (sketched.via ?? []).map((point) => frame.toWorld(point.u, point.v));
    const geometry = routeBetween({
      start,
      destination,
      via,
      obstacles,
      boundary: request.boundary,
      ignore,
      scope: request.scope,
      width: widthOf(route.width),
      skip: adjustments.reroute[sketched.name] ?? 0,
    });
    if (!geometry) continue;

    obstacles.push(geometryOutline(geometry));
    routes.push({ id: nextId(), name: sketched.name, geometry });
    if (reached) connected.add(reached);
  }

  /*
   * ---- and a way to everything the sketch did not connect ----
   *
   * **The preview used to stop at the paths the composition listed, and the harness measured what
   * that cost.** The real pipeline gives every room it placed an access attempt from the terrace
   * afterwards, so a candidate chosen partly on its circulation would acquire two or three paths
   * nobody had scored — and those are the paths that cross the planting, because they are the ones
   * nothing composed. Routes through planting rose from 26 to 44 across the fixture set when the
   * candidate loop landed, on layouts whose previews had reported clean circulation.
   *
   * Several starting points along the terrace edge for the same reason the service uses them: a
   * table or an intervening room can block the one obvious approach while three others are open.
   */
  if (terrace) {
    for (const room of placed) {
      if (room.id === terrace.id || connected.has(room.id)) continue;
      const purpose = FEATURE_LIBRARY[room.feature].zone === 'utility' ? 'utility' : 'secondary';
      const route = circulationFor(purpose, constraints);
      const ignore = [terrace.ring, room.ring, ...request.thresholds];

      /*
       * Lazily, and that is a measured decision rather than a style. Mapping every start point and
       * then taking the first non-null computes thirteen routes to find one, each of them testing
       * four polylines against every obstacle on the plot — and the first start succeeds most of
       * the time, because it is the nearest point on the terrace. Run eagerly this pass alone put
       * three and a half seconds on the biggest fixture.
       */
      let geometry: PlanGeometry | null = null;
      for (const start of terraceStarts(terrace.ring, room.ring)) {
        geometry = routeBetween({
          start,
          destination: room.ring,
          obstacles,
          boundary: request.boundary,
          ignore,
          scope: request.scope,
          width: widthOf(route.width),
          skip: adjustments.reroute[accessName(room)] ?? 0,
        });
        if (geometry) break;
      }
      if (!geometry) continue;

      obstacles.push(geometryOutline(geometry));
      routes.push({ id: nextId(), name: accessName(room), geometry });
      connected.add(room.id);
    }
  }

  /* ---- the lawn and the beds, as the sketch drew them ---- */

  const lawn = lawnRing(sketch, frame);
  const beds = sketch.beds
    .map((bed) => ({ name: bed.name, ring: shapeRing(bed.shape, frame) }))
    .filter((bed) => bed.ring.length >= 3 && polygonArea(bed.ring) > 0.5);

  /* ---- the trees ---- */

  const trees: Point[] = [];
  for (const point of sketch.trees) {
    if (trees.length >= 5) break;
    const ladder = TREE_NUDGES.slice(adjustments.treeNudge % TREE_NUDGES.length);
    const at = ladder
      .map(([du, dv]) => frame.toWorld(point.u + du, point.v + dv))
      .find((candidate) => {
        const geometry: PlanGeometry = { kind: 'point', at: candidate, radius: TREE_RADIUS };
        return (
          isPlaceablePreview(geometry, request) &&
          !obstacles.some((obstacle) => intersects(geometryOutline(geometry), obstacle)) &&
          trees.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) > 2.6)
        );
      });
    if (at) trees.push(at);
  }

  return {
    id: `${archetype.id}`,
    archetype: archetype.id,
    params,
    zonePlan,
    sketch,
    placed,
    routes,
    trees,
    lawn: lawn ? { ring: lawn, category: sketch.lawnCategory } : null,
    beds,
    unplaced,
    terraceRefused,
  };
}

/* ---------------------------------------------------------------- helpers */

function record(
  feature: DesiredFeature,
  geometry: PlanGeometry,
  slot: Slot,
  id: string,
): PlacedItem {
  const spec = FEATURE_SPECS[feature];
  const ring = geometryOutline(geometry);
  return {
    id,
    feature,
    zone: slot.zoneId ?? FEATURE_LIBRARY[feature].zone,
    slotId: slot.id,
    geometry,
    ring,
    name: spec.planName ?? feature,
    category: spec.category,
  };
}

/**
 * What an access-guarantee route is called.
 *
 * Derived from the room rather than counted, because the name is the key the `reroute` repair uses
 * to say *which* path to approach differently — an index would move the moment a repair elsewhere
 * changed how many rooms got placed.
 */
function accessName(room: PlacedItem): string {
  return `Path to ${room.name.toLowerCase()}`;
}

/**
 * Where on the terrace a path to a room may set off from.
 *
 * The nearest point on the edge first, which is the route a person would take, then quarter points
 * round the rest of it — the answer to a terrace whose obvious corner is blocked by the dining set
 * standing on it, which one start point turns into no path at all. The same thirteen the realised
 * pipeline uses, in the same order, because a preview that searched less hard would report a room
 * as unreachable that the built plan then reaches.
 */
function terraceStarts(terrace: Point[], destination: Point[]): Point[] {
  return [
    closestPointOnRing(terrace, polygonCentroid(destination), 0),
    ...terrace.flatMap((a, i) => {
      const b = terrace[(i + 1) % terrace.length]!;
      return [0.25, 0.5, 0.75].map((t) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }));
    }),
  ];
}

function footprintOf(spec: (typeof FEATURE_SPECS)[DesiredFeature]): Footprint {
  return spec.footprint.kind === 'point'
    ? { kind: 'point', radius: spec.footprint.radius }
    : { kind: 'rect', width: spec.footprint.width, depth: spec.footprint.depth };
}

function lawnRing(sketch: LayoutSketch, frame: DesignFrame): Point[] | null {
  if (!sketch.lawn) return null;
  const ring = shapeRing(sketch.lawn, frame);
  return ring.length >= 3 ? ring : null;
}

function shapeRing(shape: LayoutSketch['beds'][number]['shape'], frame: DesignFrame): Point[] {
  if (shape.kind === 'rect') {
    const { rect } = shape;
    return [
      frame.toWorld(rect.u0, rect.v0),
      frame.toWorld(rect.u1, rect.v0),
      frame.toWorld(rect.u1, rect.v1),
      frame.toWorld(rect.u0, rect.v1),
    ];
  }
  return shape.points.map((point) => frame.toWorld(point.u, point.v));
}

/**
 * Inward from a gate, towards the middle of the room.
 *
 * The real pipeline has `ResolvedGate.inward` to hand; a preview has only the point, and the
 * direction it needs is the same one — away from the fence the gate is in. Aiming at the room's
 * centroid gives it without resolving the boundary edge again.
 */
function inwardFrom(gate: Point, room: Point[]): Point {
  const centre = polygonCentroid(room);
  const dx = centre.x - gate.x;
  const dy = centre.y - gate.y;
  const length = Math.hypot(dx, dy);
  return length < 1e-9 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
}

function isPlaceablePreview(geometry: PlanGeometry, request: PreviewRequest): boolean {
  const ring = geometryOutline(geometry);
  if (ring.length < 3) return false;
  if (request.room.length >= 3 && !containedIn(ring, request.room)) return false;
  return true;
}

function containedIn(inner: Point[], outer: Point[]): boolean {
  return inner.every((point) => insidePolygon(point, outer));
}

function insidePolygon(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function intersects(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  return a.some((point) => insidePolygon(point, b)) || b.some((point) => insidePolygon(point, a));
}

/** How much of the requested list this preview actually seated. Read by the harness and the tests. */
export function placementRate(preview: LayoutPreview): number {
  const total = preview.placed.length + preview.unplaced.length;
  return total === 0 ? 1 : preview.placed.length / total;
}

/** `inradius` is re-exported so the realisation path and the preview size features identically. */
export { inradius };
