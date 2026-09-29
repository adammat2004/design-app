import { polygonContainsPolygon, type Point } from '../../geometry/primitives.js';
import { elementOutline, type DesignElement } from '../concepts.js';
import type { PlanGeometry } from '../features.js';
import { defaultMaterial } from '../materials.js';
import { SYMBOLS, type SymbolId } from '../symbols.js';
import { FURNISH_MARGIN } from './capacity.js';
import { structureDefinitionFor } from './definitions.js';

/**
 * What stands inside a structure, and the rules for changing it: the one place the generator's
 * `furnish`, the 3D editor's Inside tab and a drag across the floor all ask.
 *
 * A piece of furniture is its own element, as it has always been — the editor can still take the
 * table off the pergola and put it on the lawn. "Inside" is not stored either: it is containment in
 * the structure's outline, read every time (the rule `seatsOn` and the assistant's `attach` use), so
 * nothing goes stale when either is moved.
 */

/** The furniture that stands wholly inside a structure, in plan order. */
export function piecesInside(structure: DesignElement, elements: DesignElement[]): DesignElement[] {
  const outline = elementOutline(structure);
  return elements.filter(
    (other) =>
      other.id !== structure.id &&
      !other.hidden &&
      other.category === 'furniture' &&
      polygonContainsPolygon(outline, elementOutline(other)),
  );
}

/**
 * What each structure may have put in it from the Inside tab, in the order it is offered. A gazebo is
 * a room to sit in, a pergola an outdoor dining room; neither is a place for a trampoline.
 */
export const SUITABLE_PIECES: Partial<Record<SymbolId, SymbolId[]>> = {
  pergola: [
    'dining-set-6',
    'dining-set-4',
    'sofa-set',
    'lounger',
    'bench',
    'bbq',
    'planter',
    'parasol',
  ],
  gazebo: ['dining-set-4', 'sofa-set', 'bench', 'lounger', 'planter'],
};

/** The pieces a structure offers, or none for anything that is not a configurable structure. */
export function suitablePieces(structure: DesignElement): SymbolId[] {
  const definition = structureDefinitionFor(structure);
  return (definition && SUITABLE_PIECES[definition.symbol]) ?? [];
}

/**
 * The item's geometry, centred in the host with `FURNISH_MARGIN` clear all round, or `null` if it
 * will not go. A rect item may be turned a quarter to fit a host that runs the other way.
 */
export function fitInside(host: PlanGeometry, symbol: SymbolId, bearing = 0): PlanGeometry | null {
  const { footprint } = SYMBOLS[symbol];

  if (host.kind === 'point') {
    /*
     * Measured against the circle as drawn — a sixteen-gon, whose flats sit a little inside the
     * radius — because that is the outline the host's containment is checked against.
     */
    const inner = host.radius * Math.cos(Math.PI / 16);
    if (footprint.kind === 'point') {
      if (footprint.radius + FURNISH_MARGIN > inner) return null;
      return { kind: 'point', at: host.at, radius: footprint.radius };
    }
    if (Math.hypot(footprint.width, footprint.depth) / 2 + FURNISH_MARGIN > inner) return null;
    return {
      kind: 'rect',
      centre: host.at,
      width: footprint.width,
      depth: footprint.depth,
      rotation: bearing,
    };
  }

  if (host.kind !== 'rect') return null;

  if (footprint.kind === 'point') {
    const clear = footprint.radius * 2 + FURNISH_MARGIN * 2;
    if (clear > host.width || clear > host.depth) return null;
    return { kind: 'point', at: host.centre, radius: footprint.radius };
  }

  const fits = (w: number, d: number) =>
    w + FURNISH_MARGIN * 2 <= host.width && d + FURNISH_MARGIN * 2 <= host.depth;

  if (fits(footprint.width, footprint.depth)) {
    return {
      kind: 'rect',
      centre: host.centre,
      width: footprint.width,
      depth: footprint.depth,
      rotation: host.rotation,
    };
  }

  if (fits(footprint.depth, footprint.width)) {
    return {
      kind: 'rect',
      centre: host.centre,
      width: footprint.depth,
      depth: footprint.width,
      rotation: host.rotation,
    };
  }

  return null;
}

/** A new piece of furniture for a structure, centred in it, or `null` when it does not fit. */
export function pieceFor(
  structure: DesignElement,
  symbol: SymbolId,
  id: string,
): DesignElement | null {
  const shape = fitInside(structure.shape, symbol);
  if (!shape) return null;
  const spec = SYMBOLS[symbol];
  return {
    id,
    category: 'furniture',
    role: 'feature',
    name: spec.label,
    shape,
    zone: structure.zone,
    material: defaultMaterial('furniture'),
    elevation: structure.elevation ?? 0,
    symbol,
    height: spec.height,
  };
}

/** Whether a piece stands wholly inside a structure. */
export function standsInside(structure: DesignElement, piece: DesignElement): boolean {
  return polygonContainsPolygon(elementOutline(structure), elementOutline(piece));
}

/**
 * A piece swapped for another symbol: the new thing's own footprint and height, where the old one
 * stood and turned the same way, and — if it does not fit there with the furnishing margin clear —
 * centred in the structure. `null` when it does not fit at all.
 *
 * The plan's `replaceSymbol` keeps the old footprint, which is right for a plant and wrong here: a
 * dining set for six is not a dining set for four with a different name.
 */
export function swappedPiece(
  structure: DesignElement,
  piece: DesignElement,
  symbol: SymbolId,
): DesignElement | null {
  const spec = SYMBOLS[symbol];
  const at = pieceCentre(piece);
  const rotation =
    piece.shape.kind === 'rect' ? piece.shape.rotation : structureRotation(structure);
  const inPlace: PlanGeometry =
    spec.footprint.kind === 'point'
      ? { kind: 'point', at, radius: spec.footprint.radius }
      : {
          kind: 'rect',
          centre: at,
          width: spec.footprint.width,
          depth: spec.footprint.depth,
          rotation,
        };
  const named = {
    ...piece,
    symbol,
    name: spec.label,
    height: spec.height,
  };
  const placed = { ...named, shape: inPlace };
  // A swap is a placement, so it keeps the same clear floor round it that `fitInside` does.
  if (clearInside(structure, placed, FURNISH_MARGIN)) return placed;
  const centred = fitInside(structure.shape, symbol);
  return centred ? { ...named, shape: centred } : null;
}

/**
 * Whether a piece stands inside a structure with `margin` clear to every side. Worked in the
 * structure's own frame, where its footprint is a plain rectangle.
 */
export function clearInside(
  structure: DesignElement,
  piece: DesignElement,
  margin: number,
): boolean {
  if (structure.shape.kind !== 'rect') return standsInside(structure, piece);
  const { centre, width, depth } = structure.shape;
  const radians = (structure.shape.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return elementOutline(piece).every((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    return Math.abs(x) <= width / 2 - margin + 1e-9 && Math.abs(y) <= depth / 2 - margin + 1e-9;
  });
}

/** A piece turned a quarter, or `null` when turned it would no longer fit. */
export function turnedPiece(structure: DesignElement, piece: DesignElement): DesignElement | null {
  if (piece.shape.kind !== 'rect') return null;
  const turned = {
    ...piece,
    shape: { ...piece.shape, rotation: (piece.shape.rotation + 90) % 360 },
  };
  return standsInside(structure, turned) ? turned : null;
}

/**
 * Where a dragged piece may stand: the requested centre, held so the whole piece stays inside the
 * structure. Worked in the structure's own frame, where "inside" is a rectangle and the hold is
 * exact rather than a search.
 */
export function clampInside(structure: DesignElement, piece: DesignElement, wanted: Point): Point {
  if (structure.shape.kind !== 'rect') return wanted;
  const { centre, width, depth } = structure.shape;
  const radians = (structure.shape.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toLocal = (p: Point) => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  };
  const toPlan = (p: Point) => ({
    x: centre.x + p.x * cos - p.y * sin,
    y: centre.y + p.x * sin + p.y * cos,
  });

  // How far the piece reaches from its own centre, along the structure's axes.
  const here = toLocal(pieceCentre(piece));
  let reachX = 0;
  let reachY = 0;
  for (const point of elementOutline(piece)) {
    const local = toLocal(point);
    reachX = Math.max(reachX, Math.abs(local.x - here.x));
    reachY = Math.max(reachY, Math.abs(local.y - here.y));
  }
  // A hair inside the edge, so containment is not left to a rounding error.
  const roomX = Math.max(0, width / 2 - reachX - 1e-6);
  const roomY = Math.max(0, depth / 2 - reachY - 1e-6);
  const target = toLocal(wanted);
  return toPlan({
    x: Math.min(roomX, Math.max(-roomX, target.x)),
    y: Math.min(roomY, Math.max(-roomY, target.y)),
  });
}

/** A piece moved so its centre is at `at`. */
export function pieceAt(piece: DesignElement, at: Point): DesignElement {
  const { shape } = piece;
  if (shape.kind === 'rect') return { ...piece, shape: { ...shape, centre: at } };
  if (shape.kind === 'point') return { ...piece, shape: { ...shape, at } };
  return piece;
}

function pieceCentre(piece: DesignElement): Point {
  const { shape } = piece;
  if (shape.kind === 'rect') return shape.centre;
  if (shape.kind === 'point') return shape.at;
  const ring = elementOutline(piece);
  return {
    x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
    y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
  };
}

function structureRotation(structure: DesignElement): number {
  return structure.shape.kind === 'rect' ? structure.shape.rotation : 0;
}
