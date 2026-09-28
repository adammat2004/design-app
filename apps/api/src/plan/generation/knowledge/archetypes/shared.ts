import type { FunctionalZone, SiteAnalysis } from '../../design/types.js';
import type { LocalRect, Room } from '../../layout/sketch.js';
import {
  BED_MIN_DEPTH,
  LAWN_FLOOR,
  borderDepth,
  lawnEnd,
  lawnStart,
  terraceDepth,
} from '../../layout/sketch.js';

/**
 * The small amount of arithmetic the four new compositions share.
 *
 * Deliberately small. The three original templates each own their geometry outright and that is
 * right — a composition *is* its geometry, and factoring the interesting parts out would leave four
 * files that all call the same function and differ in an argument, which is the opposite of four
 * compositions. What is here is the mechanical part: slots from rectangles, zones from slots, and
 * the two clamps everything needs.
 */

/** A rectangle held inside the room, never inverted. `null` when there is nothing left of it. */
export function clampRect(rect: LocalRect, room: Room, inset = 0): LocalRect | null {
  const u0 = Math.max(rect.u0, Math.max(room.uMin, 0) + inset);
  const u1 = Math.min(rect.u1, room.uMax - inset);
  const v0 = Math.max(rect.v0, room.vMin + inset);
  const v1 = Math.min(rect.v1, room.vMax - inset);
  return u1 - u0 > 0.4 && v1 - v0 > 0.4 ? { u0, u1, v0, v1 } : null;
}

/**
 * The border depth this composition plants at, never under the sliver guard.
 *
 * `across` is the span the bed has to share with an open panel, and passing it applies the rule
 * that settles every argument between a border and a lawn: **the lawn's floor wins over the
 * border's profile.** A bed takes what it wants of that span only down to the point where what is
 * left is still a lawn; past that it takes what it can and, if even the sliver guard leaves nothing
 * usable, the panel is refused as it always was.
 *
 * The rule had to exist the moment `borderDepth` went from 1.5 m to 2.2: on a wide shallow plot the
 * extra seventy centimetres came straight off a 3.2 m lawn and took it under `LAWN_FLOOR`, so a
 * deeper border produced a garden with no open ground at all — a plainly worse plan drawn by a
 * change meant to improve it. Omit `across` where the bed shares its span with nothing.
 */
export function bed(scale: number, across?: number): number {
  const wanted = Math.max(BED_MIN_DEPTH, borderDepth(scale));
  if (across === undefined) return wanted;
  return Math.max(BED_MIN_DEPTH, Math.min(wanted, across - LAWN_FLOOR.minDimension));
}

/**
 * Which rooms should be connected.
 *
 * Everything hangs off the terrace, because the terrace is where you come out of the house — that
 * is the one adjacency every garden has. The primary zone joins it directly where it is not the
 * terrace itself. Phase 3's circulation planner turns these into routes; the grouping principle
 * reads them meanwhile.
 */
export function adjacencyOf(zones: FunctionalZone[], primaryId: string): [string, string][] {
  const terrace = zones.find((zone) => zone.type === 'terrace');
  if (!terrace) return [];

  const pairs: [string, string][] = [];
  for (const zone of zones) {
    if (zone.id === terrace.id) continue;
    if (zone.type === 'planting' || zone.type === 'transition') continue;
    pairs.push([terrace.id, zone.id]);
  }

  const primary = zones.find((zone) => zone.id === primaryId);
  if (primary && primary.type !== 'terrace') {
    for (const zone of zones) {
      if (zone.id === primary.id || zone.id === terrace.id) continue;
      if (zone.type !== 'utility' && zone.type !== 'productive') continue;
      pairs.push([primary.id, zone.id]);
    }
  }

  return pairs;
}

/** Whether the site gives this composition the room it needs, as a plain sentence. */
export function needs(condition: boolean, reason: string, reasons: string[]): boolean {
  if (!condition) reasons.push(reason);
  return condition;
}

/** A suitability that refuses, with the reason it refused. */
export function refuse(reason: string): { score: number; reasons: string[] } {
  return { score: 0, reasons: [reason] };
}

/** The room's own extents, guarded so a degenerate one cannot produce NaN downstream. */
export function extents(room: Room): { depth: number; width: number; uMin: number } {
  const uMin = Math.max(room.uMin, 0);
  return { depth: Math.max(0, room.uMax - uMin), width: Math.max(0, room.vMax - room.vMin), uMin };
}

export type { SiteAnalysis };

/**
 * How deep the lawn would be if it were laid *behind* a terrace on this room.
 *
 * The measurement the front-to-back compositions live or die by, and the honest way to ask whether
 * one of them suits a plot. A ratio cannot answer it: a room twice as wide as it is deep leaves a
 * generous lawn at twenty metres deep and a two-metre strip at eleven, and both have the same
 * ratio. Computed with the same helpers the templates use, so the judgement and the drawing agree.
 */
export function lawnDepthBehindTerrace(scale: number, roomDepth: number): number {
  if (roomDepth <= 0) return 0;
  const terrace = terraceDepth(scale, roomDepth);
  return Math.max(0, lawnEnd(scale, roomDepth, terrace) - lawnStart(scale, roomDepth, terrace));
}

/** Under this, a lawn behind a terrace is a strip you mow rather than a panel you use. */
export const SHALLOW_LAWN = 5;
