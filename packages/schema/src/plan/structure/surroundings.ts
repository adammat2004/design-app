import type { Point } from '../../geometry/primitives.js';
import { pointInPolygon } from '../../geometry/primitives.js';
import { WALL_REACH } from '../boundary/graph.js';
import { elementOutline, isGroundLayer, type DesignElement, type ElementCategory } from '../concepts.js';

/**
 * What lies beyond each side of a structure: the one reading the configurer and the resize both use.
 *
 * ## Why a structure needs its own reading
 *
 * The boundary graph (`boundary/graph.ts`) answers the same question for ground surfaces and is the
 * obvious thing to reuse — but it only ever takes ground surfaces as hosts, it looks 8 cm out, and
 * it cannot see the surface a thing is *standing on*. A pergola cares about all three: the terrace
 * it stands beside, the patio edge it is aligned with from on top, and a fence a metre and a half
 * away that its back screen should face. So this walks outward from each side instead, and reuses
 * the graph's `WALL_REACH` so "against the fence" means the same distance in both.
 *
 * ## Sides are named in the rect's own frame
 *
 * `front` is local +y, `rear` −y, `left` −x, `right` +x — the frame `StructureConfig.sides` and
 * `structureParts` already use, so "the left side faces the fence" and "screen the left side" are
 * about the same side by construction.
 */

export type LocalSide = 'front' | 'rear' | 'left' | 'right';
export const LOCAL_SIDES: readonly LocalSide[] = ['front', 'rear', 'left', 'right'];

export interface StructureSideLine {
  side: LocalSide;
  /** The side's two ends, in world metres. */
  a: Point;
  b: Point;
  /** Unit vector pointing away from the structure. */
  outward: Point;
}

/** What a side of a structure is against. */
export type SideNeighbour =
  | { kind: 'house' }
  | { kind: 'boundary' }
  | { kind: 'element'; id: string; category: ElementCategory; name?: string };

export interface SideReading {
  neighbour: SideNeighbour;
  /** Metres from the side to where the neighbour begins (or, for a surface underneath, ends). */
  gap: number;
}

/**
 * How far a side may be from something and still be "against" it. The boundary graph's own reach,
 * which is also what covers the generator's gaps: a terrace-end pergola is flush with its terrace
 * or one 0.25 m nudge off it, and a rear room stands 0.3 m off the fence.
 */
export const PIN_REACH = WALL_REACH;

export interface SurroundingsContext {
  elements: DesignElement[];
  boundary: Point[];
  house: Point[] | null;
}

interface RectShape {
  centre: Point;
  width: number;
  depth: number;
  rotation?: number;
}

/** The four sides of a rect in its local frame, with outward normals. Winding-independent. */
export function structureSides(rect: RectShape): Record<LocalSide, StructureSideLine> {
  const radians = ((rect.rotation ?? 0) * Math.PI) / 180;
  const u = { x: Math.cos(radians), y: Math.sin(radians) };
  const v = { x: -Math.sin(radians), y: Math.cos(radians) };
  const at = (x: number, y: number): Point => ({
    x: rect.centre.x + u.x * x + v.x * y,
    y: rect.centre.y + u.y * x + v.y * y,
  });
  const w = rect.width / 2;
  const d = rect.depth / 2;
  return {
    front: { side: 'front', a: at(-w, d), b: at(w, d), outward: v },
    rear: { side: 'rear', a: at(-w, -d), b: at(w, -d), outward: { x: -v.x, y: -v.y } },
    left: { side: 'left', a: at(-w, -d), b: at(-w, d), outward: { x: -u.x, y: -u.y } },
    right: { side: 'right', a: at(w, -d), b: at(w, d), outward: u },
  };
}

/** Where along a side the probe is taken: both ends inset, and the middle. */
const STATIONS = [0.15, 0.5, 0.85];
/** The ray is walked in steps this long. Finer than any gap the generator leaves. */
const STEP = 0.05;
/** Just inside the side: what the structure is standing on here. */
const INSIDE = 0.03;

/**
 * Whether a neighbour is something a side can be *against* — the things a resize keeps its edge
 * to. A terrace, a path, a gravel court and another building are; a lawn or a border is not, because
 * a pergola growing over the edge of the grass is ordinary, and a base fill is the whole zone.
 */
export function pinsSide(element: DesignElement): boolean {
  if (element.hidden || isGroundLayer(element)) return false;
  return (
    element.category === 'paved-area' ||
    element.category === 'gravel-mulch' ||
    element.category === 'structure'
  );
}

/**
 * What each side of a structure is against, within `reach` metres. A side with nothing is absent.
 *
 * Walks out from three stations per side and takes the nearest event any station meets: the
 * boundary (the ray leaves the plot), the house (it enters the building), a qualifying element it
 * enters, or the edge of a qualifying surface the structure is standing on (the ray leaves it). The
 * last is what makes "aligned with the patio" a relation, not only "beside the patio".
 *
 * `filter` decides which elements count; `pinsSide` is the default and the resize's rule.
 */
export function sideSurroundings(
  element: DesignElement,
  context: SurroundingsContext,
  options: { reach?: number; filter?: (other: DesignElement) => boolean } = {},
): Partial<Record<LocalSide, SideReading>> {
  if (element.shape.kind !== 'rect') return {};
  const reach = options.reach ?? PIN_REACH;
  const filter = options.filter ?? pinsSide;
  const candidates = context.elements
    .filter((other) => other.id !== element.id && filter(other))
    .map((other) => ({ element: other, ring: elementOutline(other) }));

  const sides = structureSides(element.shape);
  const found: Partial<Record<LocalSide, SideReading>> = {};

  for (const side of Object.values(sides)) {
    let best: SideReading | null = null;
    for (const t of STATIONS) {
      const origin = {
        x: side.a.x + (side.b.x - side.a.x) * t,
        y: side.a.y + (side.b.y - side.a.y) * t,
      };
      const reading = walk(origin, side.outward, reach, context, candidates);
      if (reading && (!best || reading.gap < best.gap)) best = reading;
    }
    if (best) found[side.side] = best;
  }
  return found;
}

function walk(
  origin: Point,
  outward: Point,
  reach: number,
  context: SurroundingsContext,
  candidates: { element: DesignElement; ring: Point[] }[],
): SideReading | null {
  const probe = (distance: number): Point => ({
    x: origin.x + outward.x * distance,
    y: origin.y + outward.y * distance,
  });
  const under = new Set(
    candidates.filter((c) => pointInPolygon(probe(-INSIDE), c.ring)).map((c) => c.element.id),
  );

  for (let distance = STEP / 2; distance <= reach + 1e-9; distance += STEP) {
    const at = probe(distance);
    if (context.boundary.length >= 3 && !pointInPolygon(at, context.boundary)) {
      return { neighbour: { kind: 'boundary' }, gap: distance };
    }
    if (context.house && pointInPolygon(at, context.house)) {
      return { neighbour: { kind: 'house' }, gap: distance };
    }
    // Last wins: array order is stacking order, so the topmost surface is the one you would see.
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const { element, ring } = candidates[i]!;
      const inside = pointInPolygon(at, ring);
      if (inside !== under.has(element.id)) {
        return {
          neighbour: {
            kind: 'element',
            id: element.id,
            category: element.category,
            ...(element.name ? { name: element.name } : {}),
          },
          gap: distance,
        };
      }
    }
  }
  return null;
}
