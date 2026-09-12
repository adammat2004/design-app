import {
  polygonArea,
  polygonContainsPolygon,
  polygonIsSimple,
  type Point,
} from '../geometry/primitives.js';
import { boundaryPolygon, type SiteSection } from './site.js';
import { effectiveZoneIds, type GardenZone } from './zones.js';
import type { ZoneId } from './zone-id.js';

/**
 * Which part of the property the design is allowed to change.
 *
 * Two fields on the document carry it — `site.selectedZoneIds` and `site.scopePolygon` — and the
 * *type* of scope is derived from them here rather than stored beside them. A stored
 * `type: 'custom'` would go stale the moment the outline was cleared, and then a plan would claim
 * a custom area it no longer has. Same argument as zones, openings and the roof.
 *
 * A leaf module: it reads `site.ts` and `zones.ts` and nothing reads it, so there is no cycle to
 * break. The resolvers return `null` rather than guessing, exactly as `openings.ts` and `gates.ts`
 * do — a scope ring that is not usable is a state the model can genuinely reach, and treating one
 * as "the whole plot" would turn "do not touch the rest of my garden" into its opposite in silence.
 */

/** Below this a drawn area is not a garden, it is a slip of the mouse. Square metres. */
export const MIN_SCOPE_AREA = 2;

export type DesignScope =
  /** Every zone that exists. Also what an empty tick list means — see `resolveDesignScope`. */
  | { type: 'entire_garden'; zones: ZoneId[] }
  | { type: 'zones'; zones: ZoneId[] }
  | { type: 'custom'; zones: ZoneId[]; polygon: Point[] };

/**
 * The usable scope ring, or `null`.
 *
 * Total, so no caller repeats the rule and no two callers can disagree about it. The generator
 * skips its clip entirely on `null`, which is what makes "a plan with no drawn area generates
 * exactly what it did before" structural rather than a number anybody has to check.
 */
export function scopeRing(site: Pick<SiteSection, 'scopePolygon' | 'vertices'>): Point[] | null {
  const polygon = site.scopePolygon;
  if (!polygon || polygon.length < 3) return null;

  // Self-crossing first: area is a shoelace sum, and a bow tie has a perfectly ordinary one.
  if (!polygonIsSimple(polygon)) return null;
  if (polygonArea(polygon) < MIN_SCOPE_AREA) return null;

  /*
   * An area poking outside the fence describes land the plan does not own, and `ST_Intersection`
   * would absorb the overhang without a word — so the whole ring is refused rather than quietly
   * trimmed to something the user did not draw.
   */
  const boundary = boundaryPolygon(site);
  if (boundary.length < 3 || !polygonContainsPolygon(boundary, polygon)) return null;

  return polygon;
}

/**
 * What the plan says about scope, reconciled against the zones that currently exist.
 *
 * `zones` is always the *effective* tick list, so every caller gets the same reconciliation the
 * screens already do: a tick for a zone the house has since dissolved stays in the document but is
 * never reported as selected. No ticks at all still means the whole garden, which is the reading
 * `concepts.service.ts` has always taken and the only sane one — "nothing to design" is what
 * skipping the wizard is for.
 */
export function resolveDesignScope(site: SiteSection, zones: GardenZone[]): DesignScope {
  const ticked = effectiveZoneIds(site.selectedZoneIds, zones);
  const inScope = ticked.length > 0 ? ticked : zones.map((zone) => zone.id);

  const polygon = scopeRing(site);
  if (polygon) return { type: 'custom', zones: inScope, polygon };

  return {
    type: ticked.length === 0 || ticked.length === zones.length ? 'entire_garden' : 'zones',
    zones: inScope,
  };
}
