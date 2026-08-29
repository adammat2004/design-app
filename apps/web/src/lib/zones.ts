/**
 * Zones moved into `@garden-studio/schema` wholesale.
 *
 * The server has to derive them the same way the map screen draws them: it applies
 * `effectiveZoneIds` before generating, so it cannot design into a zone the house has
 * dissolved. Two implementations of that rule would be two answers to "which gardens are we
 * designing".
 */
export {
  ZONE_ORDER,
  computeZones,
  effectiveZoneIds,
  sortZones,
  zoneAt,
  type GardenZone,
  type ZoneId,
} from '@garden-studio/schema';
