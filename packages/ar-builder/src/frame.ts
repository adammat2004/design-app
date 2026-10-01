import { planToGround, type ReferencePoint, type Vec2 } from '@garden-studio/ar-contract';
import {
  boundaryPolygon,
  gardenDirection,
  houseOpenings,
  housePolygon,
  openingCentre,
  openingNormal,
  polygonCentroid,
  resolvedGates,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import type { SceneFrame } from './types.js';

/** A door you walk into the garden through, rather than a window or the way in from the street. */
const GARDEN_DOORS = new Set(['patio-door', 'back-door']);

/**
 * Where the scene's origin is, and which way the house faces.
 *
 * The foot of the garden door, where there is one: it is the most recognisable point in a real
 * garden, the one every design is laid out from, and the first thing somebody standing in the
 * garden with a phone will tap. Among several ground-floor garden doors, the one that faces the
 * garden most squarely. Failing a door, the middle of the house wall facing the garden; failing a
 * house, the middle of the plot. Never a guess dressed as a door: `kind` says which it was.
 */
export function sceneFrame(site: SiteSection): SceneFrame {
  const outward = gardenDirection(site);
  const house = site.house;

  if (house && outward) {
    let best: { at: Point; score: number } | null = null;
    for (const opening of houseOpenings(house)) {
      if (!GARDEN_DOORS.has(opening.type) || opening.floorLevel > 0) continue;
      const at = openingCentre(house, opening);
      const normal = openingNormal(house, opening);
      if (!at || !normal) continue;
      const score = normal.x * outward.x + normal.y * outward.y;
      if (score > 0 && (!best || score > best.score)) best = { at, score };
    }
    if (best) return frameAt('garden-door', best.at, outward, site);

    const ring = housePolygon(house);
    const centre = polygonCentroid(ring);
    let wall: { at: Point; facing: number; length: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Whichever perpendicular points away from the building is this wall's outside — probed, not
      // assumed from the winding, as `openingNormal` does.
      let normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
      if (normal.x * (mid.x - centre.x) + normal.y * (mid.y - centre.y) < 0)
        normal = { x: -normal.x, y: -normal.y };
      const facing = normal.x * outward.x + normal.y * outward.y;
      if (facing < 0.7) continue;
      if (
        !wall ||
        facing > wall.facing + 1e-9 ||
        (Math.abs(facing - wall.facing) <= 1e-9 && length > wall.length)
      )
        wall = { at: mid, facing, length };
    }
    if (wall) return frameAt('garden-wall', wall.at, outward, site);
  }

  return frameAt('boundary-centroid', polygonCentroid(boundaryPolygon(site)), outward, site);
}

function frameAt(
  kind: SceneFrame['origin']['kind'],
  at: Point,
  outward: Point | null,
  site: SiteSection,
): SceneFrame {
  const length = outward ? Math.hypot(outward.x, outward.y) : 0;
  return {
    units: 'm',
    up: '+y',
    handedness: 'right',
    origin: { kind, plan: { x: at.x, y: at.y } },
    houseOutward: outward && length > 0 ? [outward.x / length, outward.y / length] : null,
    north: northOf(site.orientation ?? 0),
    location: site.location
      ? { latitude: site.location.latitude, longitude: site.location.longitude }
      : null,
  };
}

/**
 * True north as a ground direction. `orientation` is degrees clockwise from screen-up to north, and
 * screen-up is −y in the plan, which is −Z in the scene. Advisory only — a phone compass is not good
 * enough to place a garden by.
 */
export function northOf(orientation: number): Vec2 {
  const radians = (orientation * Math.PI) / 180;
  const x = Math.sin(radians);
  const z = -Math.cos(radians);
  return [Math.abs(x) < 1e-12 ? 0 : x, Math.abs(z) < 1e-12 ? 0 : z];
}

/**
 * The points a user can find in the real garden and tap to line the scene up: the house's corners
 * first (rigid, recognisable and measured), then the garden door, the plot's corners and its gates.
 */
export function referencePoints(site: SiteSection, origin: Point): ReferencePoint[] {
  const points: ReferencePoint[] = [];
  const at = (point: Point) => planToGround(point, origin);
  const house = site.house;
  if (house) {
    const ring = housePolygon(house);
    house.outline.forEach((vertex, index) => {
      const point = ring[index];
      if (point)
        points.push({
          id: `house:${vertex.id}`,
          kind: 'house-corner',
          label: `House corner ${letter(index)}`,
          at: at(point),
        });
    });
    for (const opening of houseOpenings(house)) {
      if (!GARDEN_DOORS.has(opening.type) || opening.floorLevel > 0) continue;
      const centre = openingCentre(house, opening);
      if (centre)
        points.push({
          id: `door:${opening.id}`,
          kind: 'door-centre',
          label: 'Garden door',
          at: at(centre),
        });
    }
  }
  site.vertices.forEach((vertex, index) =>
    points.push({
      id: `boundary:${vertex.id}`,
      kind: 'boundary-corner',
      label: `Plot corner ${letter(index)}`,
      at: at(vertex),
    }),
  );
  for (const gate of resolvedGates(site)) {
    points.push({
      id: `gate:${gate.gate.id}`,
      kind: 'gate-centre',
      label: 'Gate',
      at: at(gate.centre),
    });
  }
  return points;
}

function letter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}
