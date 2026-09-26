import {
  geometryOutline,
  polygonArea,
  trunkFootprint,
  SYMBOLS,
  type SymbolId,
  polygonCentroid,
  type DesignBrief,
  type DesiredFeature,
  type ElementCategory,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { FEATURE_SPECS, inradius, scaledSpec } from '../archetypes.js';
import { treeSpeciesFor } from '../constraints.js';
import type { DesignConstraints } from '../constraints.js';
import type { LayoutArchetype } from '../knowledge/archetypes/types.js';
import { FEATURE_LIBRARY, placementLadder } from '../knowledge/feature-library.js';
import { assignByPriority } from '../layout/assign.js';
import { fitInSlot, type FitContext, type Footprint } from '../layout/fit.js';
import type { DesignFrame, LocalBox } from '../layout/frame.js';
import { rectSize, type LayoutSketch, type Slot, type SketchRequest } from '../layout/sketch.js';
import { localShapeRing, treeBudget, treeCandidates } from '../layout/trees.js';
import { circulationFor } from '../room-policy.js';
import { layRoutes } from './circulation.js';
import { lowSides } from './site-analysis.js';
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

/** The fallback canopy radius, for a species whose symbol is not a disc. `concepts.service`'s own. */
const TREE_RADIUS = 1.6;

/**
 * A previewed tree: where it stands, how wide its crown is drawn and what it is.
 *
 * A bare `Point` was enough while every tree was 1.6 m whatever species it turned out to be. Now
 * that the species is chosen before the geometry, a preview that forgot the radius would hand the
 * scorer ten identical circles for a garden of hornbeams, rowans and fruit trees — and canopy
 * cover, screening and what the crowns overhang are exactly what the extra trees are judged on.
 */
export interface PreviewTree {
  at: Point;
  radius: number;
  symbol: SymbolId;
  /** Why it stands there. */
  purpose?: string;
}

/** A previewed tree as the geometry everything else in this file speaks. */
function canopyOf(tree: PreviewTree): PlanGeometry {
  return { kind: 'point', at: tree.at, radius: tree.radius };
}

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
  /** Why the composition put it here: the purpose of the slot it filled. */
  purpose?: string;
}

export interface PreviewRoute {
  id: string;
  name: string;
  geometry: PlanGeometry;
  purpose?: string;
}

export interface LayoutPreview {
  id: string;
  archetype: LayoutArchetype['id'];
  params: CandidateParams;
  zonePlan: ZonePlan;
  sketch: LayoutSketch;
  placed: PlacedItem[];
  routes: PreviewRoute[];
  trees: PreviewTree[];
  /** The open panel in world metres, before the fill pass cuts it. */
  lawn: { ring: Point[]; category: 'lawn' | 'gravel-mulch' } | null;
  beds: { name: string; ring: Point[]; purpose?: string | undefined }[];
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
  /** Rooms beyond the brief the plot can carry. The realisation passes the same number. */
  extraRooms?: number;
  /** The view from the doors, in the frame, so a composition can keep the store out of it. */
  view?: SketchRequest['view'];
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
    extraRooms: request.extraRooms ?? 0,
    view: request.view ?? null,
    gate: request.gateCentre ? frame.toLocal(request.gateCentre) : null,
    essential: request.brief.featurePriorities
      .filter((priority) => priority.tier === 'essential')
      .map((priority) => priority.feature),
    privacy: request.brief.privacy,
    lowSides: lowSides(analysis),
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

  /* ---- the routes: the sketch's own, then a way to anything they missed ---- */

  /*
   * `layRoutes` is the realisation's own pass, called with the preview's placements. **The preview
   * used to stop at the paths the composition listed, and the harness measured what that cost**:
   * the realised plan then gave every room an access attempt nobody had scored, and those were the
   * paths that crossed the planting. One function, so the two cannot search differently.
   */
  const lawn = lawnRing(sketch, frame);
  const toTarget = (item: PlacedItem) => ({
    id: item.id,
    ring: item.ring,
    name: item.name,
    utility: FEATURE_LIBRARY[item.feature].zone === 'utility',
  });
  for (const route of layRoutes({
    paths: sketch.paths,
    placed: new Map([...filled].map(([slot, item]) => [slot, toTarget(item)])),
    rooms: placed.filter((item) => item.id !== terrace?.id).map(toTarget),
    terrace: terrace?.ring ?? null,
    gate: request.gateCentre
      ? { centre: request.gateCentre, inward: inwardFrom(request.gateCentre, request.room) }
      : null,
    panel: sketch.composed ? lawn : null,
    frame,
    obstacles,
    thresholds: request.thresholds,
    boundary: request.boundary,
    scope: request.scope,
    adjustments,
    widthOf: (purpose) => circulationFor(purpose, constraints).width,
  })) {
    routes.push({
      id: nextId(),
      name: route.name,
      geometry: route.geometry,
      purpose: route.elementPurpose,
    });
  }

  /* ---- the lawn and the beds, as the sketch drew them ---- */

  const beds = sketch.beds
    .map((bed, index) => ({
      name: bed.name,
      ring: localShapeRing(bed.shape, frame),
      purpose: sketch.composed?.bedPurposes[index],
    }))
    .filter((bed) => bed.ring.length >= 3 && polygonArea(bed.ring) > 0.5);

  /* ---- the trees ---- */

  const trees: PreviewTree[] = [];
  const treeCap = treeBudget(polygonArea(request.room));
  const structures = placed
    .filter((item) => item.category === 'structure')
    .map((item) => item.ring);

  /**
   * Whether a tree stands here, asked exactly as `concepts.service` asks it.
   *
   * The trunk is what has to fit inside the room and clear of what is already drawn; the crown may
   * hang over paving, a path or a border, and may not pass through a building or another crown.
   * Any divergence here and the preview scores a garden with a different number of trees in it.
   */
  const treeFits = (at: Point, radius: number): boolean => {
    const canopy: PlanGeometry = { kind: 'point', at, radius };
    const crown = geometryOutline(canopy);
    const stem = geometryOutline(trunkFootprint(canopy));
    return (
      isPlaceablePreview(trunkFootprint(canopy), request) &&
      !obstacles.some((obstacle) => intersects(stem, obstacle)) &&
      !structures.some((structure) => intersects(crown, structure)) &&
      trees.every((other) => intersects(crown, geometryOutline(canopyOf(other))) === false)
    );
  };

  /** The species this tree would be, and therefore how wide it is drawn. Chosen before the place. */
  const nextTree = (): { symbol: SymbolId; radius: number } => {
    const symbol = treeSpeciesFor(constraints.style, trees.length);
    const spec = SYMBOLS[symbol].footprint;
    return { symbol, radius: spec.kind === 'point' ? spec.radius : TREE_RADIUS };
  };

  /* The same candidates, in the same order, the realisation plants from. See `treeCandidates`. */
  for (const candidate of treeCandidates(sketch, frame, request.room, adjustments.treeNudge)) {
    if (trees.length >= treeCap) break;
    const { symbol, radius } = nextTree();
    const at = candidate.points.find((point) => treeFits(point, radius));
    if (at) trees.push({ at, radius, symbol, purpose: candidate.purpose });
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
    ...(slot.purpose ? { purpose: slot.purpose } : {}),
  };
}

function footprintOf(spec: (typeof FEATURE_SPECS)[DesiredFeature]): Footprint {
  return spec.footprint.kind === 'point'
    ? { kind: 'point', radius: spec.footprint.radius }
    : { kind: 'rect', width: spec.footprint.width, depth: spec.footprint.depth };
}

function lawnRing(sketch: LayoutSketch, frame: DesignFrame): Point[] | null {
  if (!sketch.lawn) return null;
  const ring = localShapeRing(sketch.lawn, frame);
  return ring.length >= 3 ? ring : null;
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
