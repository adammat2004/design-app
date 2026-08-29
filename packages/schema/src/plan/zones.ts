import {
  clipToHalfPlane,
  directionFromDegrees,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  type Point,
} from '../geometry/primitives.js';
import { houseSize, type HouseFootprint } from './site.js';
import { ZONE_ORDER, type ZoneId } from './zone-id.js';

/**
 * Derives the usable garden zones from where the house sits inside the property.
 *
 * The whole point of placing the house as a shape rather than tagging a boundary edge is that
 * front / back / side gardens fall out of its position and rotation. Everything here is pure
 * and self-contained: swapping this for a more sophisticated splitter later means replacing
 * `computeZones` and nothing else.
 *
 * Zones are **derived, never stored** — recomputing them means they can never go stale against
 * a house the user has since moved. Only `selectedZoneIds` is persisted, and the server runs
 * this same function before generating, so it cannot design into a zone the house has
 * dissolved.
 *
 * Orientation is a fixed local frame. At 0 degrees the house faces +y — screen-down — so the
 * front garden is below it and the back garden above. Rotating the house rotates all four
 * zones with it, which keeps the labels stable while the user nudges things around. The
 * alternative, picking whichever boundary edge is nearest as the front, makes labels flip
 * without warning mid-drag.
 *
 * The four zones are bands, not wedges: front and back are the strips off the house's front and
 * back walls, fenced to the house's own width, and the two sides run the full depth of the plot
 * and take the corners with them. That split has to fall one way or the other — a corner belongs
 * to exactly one garden — and giving it to the sides matches how a side return is understood,
 * as a strip running the whole way down the property.
 */

export interface GardenZone {
  id: ZoneId;
  /** One name everywhere — on the plan and in the Design areas checklist. */
  label: string;
  polygon: Point[];
  area: number;
  centroid: Point;
}

/** Zones smaller than this are slivers, not gardens — a house flush against a fence. */
const MIN_ZONE_AREA = 0.5;

/**
 * `bearing` is the direction from the house centre out towards that zone, in degrees clockwise
 * from +x before rotation is applied. The two sides sit on the house's width axis
 * (`bearing % 180 === 0`), which is also what decides who takes the corners.
 */
const ZONE_DEFINITIONS: { id: ZoneId; bearing: number; label: string }[] = [
  { id: 'front', bearing: 90, label: 'Front garden' },
  { id: 'right', bearing: 0, label: 'Right side' },
  { id: 'back', bearing: 270, label: 'Back garden' },
  { id: 'left', bearing: 180, label: 'Left side' },
];

export function computeZones(boundary: Point[], house: HouseFootprint | null): GardenZone[] {
  if (!house || boundary.length < 3) return [];

  const { width, depth } = houseSize(house);
  const zones: GardenZone[] = [];

  for (const definition of ZONE_DEFINITIONS) {
    const bearing = definition.bearing + house.rotation;
    const isSide = definition.bearing % 180 === 0;

    const outward = directionFromDegrees(bearing);
    /** Half the house's extent along this zone's own axis. */
    const reach = (isSide ? width : depth) / 2;

    /*
     * Every zone starts by clipping away everything short of the house wall it faces. That one
     * plane is what subtracts the house — cheaper and more predictable than a polygon boolean,
     * and it guarantees the zone's centroid never lands on the house itself.
     */
    let polygon = clipToHalfPlane(
      boundary,
      { x: house.centre.x + outward.x * reach, y: house.centre.y + outward.y * reach },
      outward,
    );

    /*
     * Front and back are then fenced to the house's own width, which is what keeps them from
     * overlapping the sides. The sides get no such fence, so they run the full depth of the plot
     * and take the four corners — see the note at the top of the file.
     */
    if (!isSide) {
      const cross = directionFromDegrees(bearing + 90);
      const half = width / 2;

      polygon = clipToHalfPlane(
        polygon,
        { x: house.centre.x + cross.x * half, y: house.centre.y + cross.y * half },
        { x: -cross.x, y: -cross.y },
      );
      polygon = clipToHalfPlane(
        polygon,
        { x: house.centre.x - cross.x * half, y: house.centre.y - cross.y * half },
        cross,
      );
    }

    const area = polygonArea(polygon);
    if (area < MIN_ZONE_AREA) continue;

    zones.push({
      id: definition.id,
      label: definition.label,
      polygon,
      area,
      centroid: polygonCentroid(polygon),
    });
  }

  return zones;
}

/**
 * Which zone a point sits in, or null if it is on the house or outside the plot. This is how an
 * existing feature is told which garden it belongs to.
 *
 * The bands are disjoint by construction — each is clipped out of the plot rather than drawn
 * over it — so the only ambiguity is a point exactly on the seam between two of them, where
 * `pointInPolygon` counts it as inside both and the first in `ZONE_DEFINITIONS` order wins.
 */
export function zoneAt(point: Point, zones: GardenZone[]): GardenZone | null {
  return zones.find((zone) => pointInPolygon(point, zone.polygon)) ?? null;
}

export function sortZones(zones: GardenZone[]): GardenZone[] {
  return [...zones].sort((a, b) => ZONE_ORDER.indexOf(a.id) - ZONE_ORDER.indexOf(b.id));
}

/**
 * The design scope, filtered to zones that actually exist. Moving the house can dissolve a
 * zone; the tick stays in the document so it comes back if the house moves away again, but it
 * must not be reported as selected in the meantime.
 */
export function effectiveZoneIds(selectedIds: ZoneId[], zones: GardenZone[]): ZoneId[] {
  return zones.filter((zone) => selectedIds.includes(zone.id)).map((zone) => zone.id);
}
