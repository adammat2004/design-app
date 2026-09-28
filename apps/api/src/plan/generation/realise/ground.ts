import type {
  DesignElement,
  GardenZone,
  HouseFootprint,
  PlanGeometry,
  ZoneId,
} from '@garden-studio/schema';
import type { fillPalette } from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import { baseFillFor, passageStrip, passageSurface, type ZoneRole } from '../layout/zone-roles.js';

export interface GroundContext {
  zones: GardenZone[];
  roles: Map<ZoneId, ZoneRole>;
  house: HouseFootprint | null;
  palette: ReturnType<typeof fillPalette>;
  constraints: DesignConstraints;
  index: number;
  nextId: () => string;
  /** How deep and how big the front garden is, which is what decides whether its base is turf. */
  frontExtent: { depth: number | null; area: number };
}

/**
 * The ground under everything: a base fill that is exactly each zone, so no chosen zone is left as
 * bare graph paper, and a hard strip down each passage beside the house. Laid first, so the borders
 * sit on the strips and the paths run over them.
 */
export function groundCover(context: GroundContext): DesignElement[] {
  const out: DesignElement[] = [];
  for (const zone of context.zones) {
    /*
     * The base layer: exactly the zone polygon. Coverage is guaranteed by the z-order rather
     * than by the accuracy of any subtraction, which is why true booleans do not let us drop it.
     * It is the palette's ground cover, never planting — `baseFillFor` says why — and the only
     * zone whose base the role may change is the front, whose polygon is exactly the front garden.
     */
    const { category, material } = baseFillFor(
      context.roles.get(zone.id) ?? 'remote',
      context.palette,
      context.constraints,
      context.index,
      context.frontExtent,
    );
    out.push({
      id: context.nextId(),
      category,
      role: 'fill',
      fillKind: 'base',
      shape: { kind: 'polygon', points: zone.polygon, cornerRadius: 0 },
      zone: zone.id,
      material,
    });
  }

  /*
   * ---- the passages: a hard strip beside the house and round to the front corner ----
   *
   * Laid before the borders, so a passage's fence bed sits on the strip and the side path runs
   * over it. The corners behind the house are not in the strip; they are the room's, and the
   * lawn and the beds design them.
   */
  if (context.house) {
    for (const zone of context.zones) {
      if (context.roles.get(zone.id) !== 'passage') continue;
      const strip = passageStrip(zone, context.house);
      if (!strip) continue;
      /*
       * Not checked against the house, for the same reason the base fill under it is not: this
       * is ground derived from the zone, and a zone's inner edge *is* the house's wall plane.
       * `computeZones` clips there in floating point, so a strip can overlap the wall by a
       * fraction of a nanometre — which had `geometryClearsHouse` reject one side return and
       * accept the other on the same symmetrical plot. The house is painted opaquely and last
       * in every renderer, so ground beneath its wall line is never seen.
       */
      const shape: PlanGeometry = { kind: 'polygon', points: strip, cornerRadius: 0 };
      out.push({
        id: context.nextId(),
        ...passageSurface(context.constraints),
        role: 'fill',
        fillKind: 'accent',
        name: 'Side return',
        purpose: 'passage',
        shape,
        zone: zone.id,
      });
    }
  }
  return out;
}
