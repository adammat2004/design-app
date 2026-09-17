import { measureComposition, type CompositionReport, type GardenZone } from '@garden-studio/schema';
import type { DesignSubject } from './subject.js';

/**
 * What the ground is covered with, measured once and read by two principles.
 *
 * `measureComposition` lays a grid over the designed zones and asks what is on top at every point.
 * It is the most expensive thing in the scorer — a few thousand point-in-polygon tests against every
 * element — and both `proportion` and `maintenanceFit` need the answer. Measuring it twice would
 * double the cost of a pass that runs fifty times per generation for no second opinion: the two
 * principles disagree about what the shares *should* be, never about what they are.
 */

export interface Measured {
  report: CompositionReport;
  /** The zones the shares are over: the ones the user asked to have designed. */
  zones: GardenZone[];
  /** Square metres the shares are fractions of. */
  area: number;
}

export function measure(subject: DesignSubject, step?: number): Measured | null {
  const zones = inScopeZones(subject);
  if (zones.length === 0) return null;

  const report = measureComposition(subject.elements, zones, step);
  if (report.sampledArea <= 0) return null;

  return { report, zones, area: report.sampledArea };
}

/**
 * The zones in scope, or all of them when nothing was ticked.
 *
 * A user who drew a redesign area round the back garden is not designing the front, and measuring
 * the shares over ground nobody asked about would report their untouched lawn as this concept's
 * composition.
 */
export function inScopeZones(subject: DesignSubject): GardenZone[] {
  const ids = subject.analysis.scope.zones;
  const zones = subject.analysis.zones;
  return ids.length > 0 ? zones.filter((zone) => ids.includes(zone.id)) : zones;
}

/**
 * The share of the ground that is grass, base fills included.
 *
 * `measureComposition` files a base fill as `undesigned` whatever it is made of, which is the right
 * answer to "how much of this garden has been designed" and the wrong one to "how much of it has to
 * be mown" — a base turf fill showing through is a lawn, and somebody has to cut it. So the
 * undesigned share is counted as grass in proportion to how many of the zones in scope have a lawn
 * underneath them, which is exact when every zone agrees and an honest approximation when they do
 * not.
 */
export function mownShare(measured: Measured): number {
  const { report, zones } = measured;

  const bases = zones.map((zone) => report.baseByZone[zone.id]);
  const grassy = bases.filter((category) => category === 'lawn').length;
  const share = bases.length > 0 ? grassy / bases.length : 0;

  return Math.min(1, report.shares.lawn + report.shares.undesigned * share);
}
