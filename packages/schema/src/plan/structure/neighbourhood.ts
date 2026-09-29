import { clipToHalfPlane, pointInPolygon, type Point } from '../../geometry/primitives.js';
import type { BoundaryKind } from '../boundary-style.js';
import { boundaryRuns } from '../boundary-styles.js';
import { elementOutline, type DesignElement, type ElementCategory } from '../concepts.js';
import { trunkFootprint } from '../footprint.js';
import { heightFor, houseHeight } from '../heights.js';
import { OPENING_HEIGHTS, STOREY_HEIGHT, type OpeningType } from '../opening.js';
import { houseOpenings, openingNormal, openingSegment } from '../openings.js';
import { housePolygon, type SiteSection } from '../site.js';
import { isTreeSymbol, resolveSymbol } from '../symbols.js';
import { resolveStructure, structureDefinitionFor, type ResolvedStructure } from './definitions.js';
import { piecesInside } from './furnish.js';

/**
 * What stands around a structure, for the 3D editor to draw it among: the ground it is on, the bed
 * behind it, the fence it is screened against, the house, a tree over it, the table under it.
 *
 * ## A neighbourhood, not a garden
 *
 * Everything is cut to a window a few metres beyond the structure. The editor is for refining one
 * structure, and it needs enough of the garden to judge that against — not the whole garden, which
 * would be the retired Visualise view in a new engine (see "Visualise was removed" in CLAUDE.md).
 *
 * ## Decided here, drawn there
 *
 * Pure and plain data, like the AR contract's rule that geometry is decided before a renderer sees
 * it: the web draws what this returns and decides nothing about where anything is. Everything is in
 * the **structure's own local frame** — the one `structureParts` and `StructureModel` already use:
 * origin on the ground at the rect's centre, X along its width, Z towards its open front (rect-local
 * +y), heights measured from the structure's own base. That is the ar-contract's plan → scene
 * mapping (`planToScene`, then `rotateAboutY` by the rect's yaw), so this is also a first cut of
 * the AR builder's placement.
 *
 * ## What it does not do
 *
 * Surfaces keep the plan's overlaps — a base fill is the whole zone and the terrace is drawn over it
 * — and carry their stacking order as `layer`, for the renderer to lift each a hair above the last.
 * That is right for a close view in an editor. An AR scene needs the true cut (surfaces there must
 * never overlap), which is the AR builder's job and is not faked here.
 */

/** A point in the structure's local frame, on the ground: X across, Z towards the front. */
export interface LocalPoint {
  x: number;
  z: number;
}

export interface NeighbourhoodSurface {
  id: string;
  category: ElementCategory;
  material: string | null;
  ring: LocalPoint[];
  /** Metres above the structure's base: a raised terrace sits at its own elevation. */
  y: number;
  /** Stacking order, from the plan's element order: higher is drawn over lower. */
  layer: number;
}

export interface NeighbourhoodSolid {
  id: string;
  kind: 'boundary' | 'building' | 'furniture' | 'feature';
  /** For a boundary run, what it is built as. */
  boundary?: BoundaryKind;
  /**
   * For a boundary run, its line as cut to the window and the unit direction into the plot — what a
   * fence's posts are spaced along and which face its boards are on.
   */
  run?: { start: LocalPoint; end: LocalPoint; inward: LocalPoint };
  category?: ElementCategory;
  /** The product symbol, where it has one: what a piece of furniture is, for the form it is drawn as. */
  symbol?: string;
  material: string | null;
  ring: LocalPoint[];
  base: number;
  height: number;
}

export interface NeighbourhoodPlant {
  id: string;
  kind: 'tree' | 'shrub';
  /** The species symbol, where it has one: what shape of tree to draw. */
  symbol?: string;
  at: LocalPoint;
  /** Crown radius in metres. */
  canopy: number;
  height: number;
  trunk: number;
  base: number;
}

export interface NeighbourhoodStructure {
  id: string;
  structure: ResolvedStructure;
  at: LocalPoint;
  /** Radians about +Y relative to the structure being edited, the ar-contract's yaw convention. */
  yaw: number;
  base: number;
}

export interface NeighbourhoodOpening {
  type: OpeningType;
  /** The opening's span along the wall, in the local frame. */
  a: LocalPoint;
  b: LocalPoint;
  /** Unit direction out of the house. */
  outward: LocalPoint;
  /** Metres above the house's ground: the sill, and the head. */
  bottom: number;
  top: number;
}

export interface NeighbourhoodHouse {
  ring: LocalPoint[];
  base: number;
  eaves: number;
  roofMaterial: string;
  /** Its doors and windows, so a wall in 3D shows where the garden is entered from. */
  openings: NeighbourhoodOpening[];
}

/**
 * A structure's local frame, both ways: plan metres to local (X across, Z towards the front) and
 * back. The one definition every consumer of the neighbourhood uses — the 3D editor needs the way
 * back to turn a drag across the floor into a plan position.
 */
export interface LocalFrame {
  toLocal(point: Point): LocalPoint;
  toPlan(point: LocalPoint): Point;
  /** The structure's own rotation, in plan degrees clockwise. */
  rotation: number;
}

export function localFrame(element: DesignElement): LocalFrame | null {
  if (element.shape.kind !== 'rect') return null;
  const { centre } = element.shape;
  const rotation = element.shape.rotation ?? 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    rotation,
    toLocal: (point) => {
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      return { x: dx * cos + dy * sin, z: -dx * sin + dy * cos };
    },
    toPlan: (point) => ({
      x: centre.x + point.x * cos - point.z * sin,
      y: centre.y + point.x * sin + point.z * cos,
    }),
  };
}

export interface StructureNeighbourhood {
  /** Half the side of the square window everything is cut to, in local metres. */
  half: number;
  /** Where the garden's ground is, measured from the structure's own base: below it when raised. */
  ground: number;
  surfaces: NeighbourhoodSurface[];
  solids: NeighbourhoodSolid[];
  /**
   * The furniture standing inside the structure — what the 3D editor lets you pick up and move —
   * kept apart from the surroundings, which are only ever looked at.
   */
  interior: NeighbourhoodSolid[];
  plants: NeighbourhoodPlant[];
  structures: NeighbourhoodStructure[];
  house: NeighbourhoodHouse | null;
}

/** How far past the structure the neighbourhood reaches. A border, a path and a bit of lawn. */
export const NEIGHBOURHOOD_REACH = 6;

const GROUND: ElementCategory[] = [
  'lawn',
  'planting-bed',
  'paved-area',
  'gravel-mulch',
  'water-feature',
];

type Site = Pick<SiteSection, 'vertices' | 'boundaryStyles' | 'house'>;

/**
 * The neighbourhood of a configurable structure, or `null` for anything that is not one.
 */
export function structureNeighbourhood(
  element: DesignElement,
  context: { elements: DesignElement[]; site: Site },
  options: { reach?: number } = {},
): StructureNeighbourhood | null {
  const definition = structureDefinitionFor(element);
  if (!definition || element.shape.kind !== 'rect') return null;

  const { width, depth } = element.shape;
  const frame = localFrame(element)!;
  const { rotation, toLocal } = frame;
  const half = Math.max(width, depth) / 2 + (options.reach ?? NEIGHBOURHOOD_REACH);
  const floor = element.elevation ?? 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const inside = new Set(piecesInside(element, context.elements).map((piece) => piece.id));
  const localRing = (ring: Point[]) => ring.map(toLocal);
  const touches = (ring: LocalPoint[]) => {
    const reach = half;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return maxX >= -reach && minX <= reach && maxZ >= -reach && minZ <= reach;
  };
  const clipped = (ring: LocalPoint[]): LocalPoint[] => clipToWindow(ring, half);

  const neighbourhood: StructureNeighbourhood = {
    half,
    ground: -floor,
    surfaces: [],
    solids: [],
    interior: [],
    plants: [],
    structures: [],
    house: null,
  };

  context.elements.forEach((other, layer) => {
    if (other.id === element.id || other.hidden) return;
    const base = (other.elevation ?? 0) - floor;
    const symbol = resolveSymbol(other);

    // Plants: a canopy standing on a point. A tree outside the window may still reach over it.
    if (other.category === 'planting-bed' && other.shape.kind === 'point') {
      const at = toLocal(other.shape.at);
      const canopy = other.shape.radius;
      if (Math.max(Math.abs(at.x), Math.abs(at.z)) - canopy > half) return;
      const trunk = trunkFootprint(other.shape);
      const tree = symbol ? isTreeSymbol(symbol) : canopy >= 1.2;
      neighbourhood.plants.push({
        id: other.id,
        kind: tree ? 'tree' : 'shrub',
        ...(symbol ? { symbol } : {}),
        at,
        canopy,
        height: heightFor(other),
        trunk: trunk.kind === 'point' ? trunk.radius : canopy * 0.12,
        base,
      });
      return;
    }

    if (other.category === 'lighting') return;

    if (GROUND.includes(other.category)) {
      const ring = clipped(localRing(elementOutline(other)));
      if (ring.length < 3) return;
      neighbourhood.surfaces.push({
        id: other.id,
        category: other.category,
        material: other.material ?? null,
        ring,
        y: base,
        layer,
      });
      return;
    }

    const ring = localRing(elementOutline(other));
    if (!touches(ring)) return;

    const resolved = resolveStructure(other);
    if (resolved && other.shape.kind === 'rect') {
      neighbourhood.structures.push({
        id: other.id,
        structure: resolved,
        at: toLocal(other.shape.centre),
        yaw: -(((other.shape.rotation ?? 0) - rotation) * Math.PI) / 180,
        base,
      });
      return;
    }

    (inside.has(other.id) ? neighbourhood.interior : neighbourhood.solids).push({
      id: other.id,
      kind:
        other.category === 'furniture'
          ? 'furniture'
          : other.category === 'structure'
            ? 'building'
            : 'feature',
      category: other.category,
      ...(other.symbol ? { symbol: other.symbol } : {}),
      material: other.material ?? null,
      ring,
      base,
      height: heightFor(other),
    });
  });

  // The boundary: each run cut to the window and thickened inward, the way the plan draws its band.
  const boundary = context.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  for (const run of boundaryRuns(context.site)) {
    if (run.kind === 'open' || run.height <= 0) continue;
    const inward = inwardNormal(run.start, run.end, boundary);
    const a = toLocal(run.start);
    const b = toLocal(run.end);
    const span = clipSegment(a, b, half);
    if (!span) continue;
    const n = rotateLocal(inward, cos, sin);
    const t = run.thickness;
    const ring = [
      span[0],
      span[1],
      { x: span[1].x + n.x * t, z: span[1].z + n.z * t },
      { x: span[0].x + n.x * t, z: span[0].z + n.z * t },
    ];
    neighbourhood.solids.push({
      id: `boundary-${run.edgeVertexId}`,
      kind: 'boundary',
      boundary: run.kind,
      run: { start: span[0], end: span[1], inward: n },
      material: null,
      ring,
      base: -floor,
      height: run.height,
    });
  }

  // The house: whole, never cut — a sliced building reads as broken, and the fog takes its far end.
  const house = context.site.house;
  if (house) {
    const ring = localRing(housePolygon(house));
    if (touches(ring)) {
      const openings: NeighbourhoodOpening[] = [];
      for (const opening of houseOpenings(house)) {
        const span = openingSegment(house, opening);
        const out = openingNormal(house, opening);
        if (!span || !out) continue;
        const bottom = opening.floorLevel * STOREY_HEIGHT + opening.sillHeight;
        openings.push({
          type: opening.type,
          a: toLocal(span[0]),
          b: toLocal(span[1]),
          outward: rotateLocal(out, cos, sin),
          bottom,
          top: bottom + OPENING_HEIGHTS[opening.type],
        });
      }
      neighbourhood.house = {
        ring,
        base: -floor,
        eaves: houseHeight(house),
        roofMaterial: house.roofMaterial ?? 'slate',
        openings,
      };
    }
  }

  return neighbourhood;
}

/** Cut a ring to the square window with four half-planes. Convex clipper, so this is exact. */
function clipToWindow(ring: LocalPoint[], half: number): LocalPoint[] {
  let points: Point[] = ring.map((p) => ({ x: p.x, y: p.z }));
  const planes: [Point, Point][] = [
    [
      { x: -half, y: 0 },
      { x: 1, y: 0 },
    ],
    [
      { x: half, y: 0 },
      { x: -1, y: 0 },
    ],
    [
      { x: 0, y: -half },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: half },
      { x: 0, y: -1 },
    ],
  ];
  for (const [origin, normal] of planes) {
    points = clipToHalfPlane(points, origin, normal);
    if (points.length < 3) return [];
  }
  return points.map((p) => ({ x: p.x, z: p.y }));
}

/** Liang–Barsky: the part of a segment inside the square window, or `null`. */
function clipSegment(a: LocalPoint, b: LocalPoint, half: number): [LocalPoint, LocalPoint] | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x + half],
    [dx, half - a.x],
    [-dz, a.z + half],
    [dz, half - a.z],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  if (t1 - t0 < 1e-9) return null;
  return [
    { x: a.x + dx * t0, z: a.z + dz * t0 },
    { x: a.x + dx * t1, z: a.z + dz * t1 },
  ];
}

/** The unit normal of a boundary edge that points into the plot, found by probing. */
function inwardNormal(start: Point, end: Point, boundary: Point[]): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const probe = { x: mid.x + normal.x * 0.05, y: mid.y + normal.y * 0.05 };
  return boundary.length >= 3 && !pointInPolygon(probe, boundary)
    ? { x: -normal.x, y: -normal.y }
    : normal;
}

/** A plan direction turned into the local frame. */
function rotateLocal(direction: Point, cos: number, sin: number): LocalPoint {
  return { x: direction.x * cos + direction.y * sin, z: -direction.x * sin + direction.y * cos };
}
