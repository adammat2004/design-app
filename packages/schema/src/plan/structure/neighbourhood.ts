import type { Point } from '../../geometry/primitives.js';
import { elementOutline, type DesignElement, type ElementCategory } from '../concepts.js';
import { heightFor } from '../heights.js';
import type { OpeningType } from '../opening.js';
import { structureDefinitionFor } from './definitions.js';
import { piecesInside } from './furnish.js';

/**
 * A structure's own frame, and the furniture standing inside it — what the 3D structure editor
 * needs beyond the garden around it.
 *
 * ## The garden around it is the scene now
 *
 * This module used to decide everything the editor drew round a structure: the ground cut to a
 * window, the beds, the fence, the house, the trees, the neighbouring pergolas. That was a second
 * classifier of the plan into 3D beside the AR scene builder (`packages/ar-builder`), and two answers
 * to "what does the garden look like in 3D" drift. The editor now draws the builder's scene under one
 * transform into this frame (stage 5 of the whole-garden preview). What is left here is what only the
 * editor needs: the frame both ways, and the pieces a user can pick up and move — read live, because
 * that is what is being edited.
 */

/** A point in the structure's local frame, on the ground: X across, Z towards the front. */
export interface LocalPoint {
  x: number;
  z: number;
}

/** A piece of furniture standing inside the structure, in its local frame. */
export interface NeighbourhoodSolid {
  id: string;
  kind: 'furniture' | 'building' | 'feature';
  category?: ElementCategory;
  /** The product symbol, where it has one: what a piece of furniture is, for the form it is drawn as. */
  symbol?: string;
  material: string | null;
  ring: LocalPoint[];
  /** Metres above the structure's own base. */
  base: number;
  height: number;
}

/** A door or a window on a wall, in some local frame: what `HouseOpening` draws. */
export interface NeighbourhoodOpening {
  type: OpeningType;
  /** The opening's span along the wall. */
  a: LocalPoint;
  b: LocalPoint;
  /** Unit direction out of the house. */
  outward: LocalPoint;
  /** Metres above the house's ground: the sill, and the head. */
  bottom: number;
  top: number;
}

/**
 * A structure's local frame, both ways: plan metres to local (X across, Z towards the front) and
 * back. It is the ar-contract's plan → scene mapping (`planToScene`, then `rotateAboutY` by the rect's
 * yaw), which is what lets the editor draw the scene under one transform. The 3D editor needs the way
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

/**
 * How far past the structure the editor's garden is drawn in full detail — painted with the plan's
 * own ground and within the fog's clear range. Beyond it the scene is still there, in flat colour,
 * fading into the haze. A border, a path and a bit of lawn.
 */
export const NEIGHBOURHOOD_REACH = 6;

/**
 * The furniture standing inside a configurable structure, in its local frame, at its own height
 * above the structure's base — the pieces the editor lets a user pick up and move. `null` for
 * anything that is not a configurable structure.
 */
export function structureInterior(element: DesignElement, elements: DesignElement[]): NeighbourhoodSolid[] | null {
  if (!structureDefinitionFor(element) || element.shape.kind !== 'rect') return null;
  const frame = localFrame(element)!;
  const floor = element.elevation ?? 0;
  return piecesInside(element, elements).map((piece) => ({
    id: piece.id,
    kind: piece.category === 'furniture' ? 'furniture' : piece.category === 'structure' ? 'building' : 'feature',
    category: piece.category,
    ...(piece.symbol ? { symbol: piece.symbol } : {}),
    material: piece.material ?? null,
    ring: elementOutline(piece).map(frame.toLocal),
    base: (piece.elevation ?? 0) - floor,
    height: heightFor(piece),
  }));
}
