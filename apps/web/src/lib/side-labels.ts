import {
  directionFromDegrees,
  edgeInwardNormal,
  elementAnchor,
  geometryOutline,
  sampleChain,
  sideChains,
  housePolygon,
  houseWalls,
  polygonCentroid,
  streetEdge,
  wallNormal,
  type DesignElement,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';

/**
 * What to call a side of the property, or a wall of the house, in the editor's header.
 *
 * Never a compass word. The plot can be drawn at any angle and the canvas can be panned, so
 * "north side" is only true if the user set an orientation, and "left side" is only true of the
 * screen. What *is* honest is the relationship to the house: a side faces the street, or lies
 * behind the house, or is on your left as you stand at the back door looking out.
 *
 * **The back is the house's own bearing 270, which is what `computeZones` uses — deliberately not
 * `gardenDirection`.** The two disagree: zones name the back from the house's rotation, while
 * `gardenDirection` infers it from where the most plot lies, and on a centred house that inference
 * can land on a side. The canvas already writes "Back garden" across the zone in question, so a
 * panel that called the same strip "Left side" would be contradicting a label the user can see two
 * inches away. Agreeing with what is on screen is worth more here than agreeing with the
 * generator's own inference, which is about where to *design* rather than what to *call* a side.
 *
 * Every function returns `null` rather than guessing when there is no house to look out from.
 */

/** Anything more head-on than this reads as "facing"; between, it is a side. */
const FACING = 0.7;

export type SideDescriptor = 'faces-street' | 'back' | 'front' | 'left' | 'right';

const SIDE_LABELS: Record<SideDescriptor, string> = {
  'faces-street': 'Faces the street',
  back: 'Back of the garden',
  front: 'Front of the property',
  left: 'Left side, looking out from the house',
  right: 'Right side, looking out from the house',
};

export const WALL_DESCRIPTORS: Record<SideDescriptor, string> = {
  'faces-street': 'Faces the street',
  back: 'Faces the back garden',
  front: 'Faces the front',
  left: 'Left of the house, looking out',
  right: 'Right of the house, looking out',
};

/** Which way is "right" when looking along `direction`, in the plan's y-down frame. */
function rightOf(direction: Point): Point {
  return { x: -direction.y, y: direction.x };
}

/** The way the zone labels call the back: the house's own bearing 270. */
function backOfHouse(site: SiteSection): Point | null {
  return site.house ? directionFromDegrees(270 + site.house.rotation) : null;
}

function classify(outward: Point, garden: Point): SideDescriptor {
  const along = outward.x * garden.x + outward.y * garden.y;
  if (along > FACING) return 'back';
  if (along < -FACING) return 'front';

  const right = rightOf(garden);
  return outward.x * right.x + outward.y * right.y > 0 ? 'right' : 'left';
}

/** The relationship of a boundary side to the house, or `null` without a house. */
export function describeSide(site: SiteSection, edgeVertexId: string): SideDescriptor | null {
  if (site.streetEdgeVertexId === edgeVertexId && streetEdge(site)) return 'faces-street';

  const inward = edgeInwardNormal(site, edgeVertexId);
  const back = backOfHouse(site);
  if (!inward || !back) return null;

  return classify({ x: -inward.x, y: -inward.y }, back);
}

/** The relationship of a house wall to the garden, or `null` when it cannot be told. */
export function describeWall(site: SiteSection, wallId: string): SideDescriptor | null {
  const { house } = site;
  if (!house) return null;

  const outward = wallNormal(house, wallId);
  const back = backOfHouse(site);
  if (!outward || !back) return null;

  const descriptor = classify(outward, back);
  // The wall towards the street is the front, and "faces the street" says it better.
  return descriptor === 'front' && site.streetEdgeVertexId ? 'faces-street' : descriptor;
}

export function sideLabel(descriptor: SideDescriptor | null): string | null {
  return descriptor ? SIDE_LABELS[descriptor] : null;
}

/** What to call a side of a surface in the garden: short, because four of them sit in a row. */
export const ELEMENT_SIDE_LABELS: Record<SideDescriptor, string> = {
  'faces-street': 'Street side',
  front: 'House side',
  back: 'Far side',
  left: 'Left',
  right: 'Right',
};

/**
 * The relationship of one side of a surface to the house, or `null` where it cannot be told.
 *
 * Judged against the **nearest house wall**, not the house's fixed back bearing: a bed in a side
 * return has the house on its flank, and calling that flank "Left" because the house's back faces
 * the other way would label the one side the user can see the house from as something else. The
 * outward normal of the side is classified against that wall's own outward normal — the wall
 * points into the garden, so a side pointing the *opposite* way faces the house.
 *
 * Read off the side *chain*, not off two corners, so it answers for every shape the boundary graph
 * knows: a rectangle's side, a rounded bed's curve, either side of a path. A circular bed's single
 * chain goes all the way round and faces nothing in particular, so it answers `null`.
 */
export function describeElementSide(
  element: DesignElement,
  site: SiteSection,
  side: number,
): SideDescriptor | null {
  const chain = sideChains(element.shape)[side];
  if (!chain || chain.closed || !site.house) return null;

  const outward = sideOutwardNormal(element, chain.measure);
  const garden = nearestWallNormal(site, elementAnchor(element)) ?? backOfHouse(site);
  if (!outward || !garden) return null;

  return classify(outward, garden);
}

/** A short label for the side, or a plain ordinal where the plan cannot say more. */
export function elementSideLabel(descriptor: SideDescriptor | null, side: number, closed = false): string {
  if (closed) return 'All round';
  return descriptor ? ELEMENT_SIDE_LABELS[descriptor] : `Side ${side + 1}`;
}

/** The unit normal at the middle of a side, pointing away from the surface. Indifferent to winding. */
function sideOutwardNormal(
  element: DesignElement,
  measure: Parameters<typeof sampleChain>[0],
): Point | null {
  if (measure.length <= 0) return null;
  const { at, tangent } = sampleChain(measure, measure.length / 2);
  const normal = { x: -tangent.y, y: tangent.x };
  const centre = polygonCentroid(geometryOutline(element.shape));
  const away = { x: at.x - centre.x, y: at.y - centre.y };
  return away.x * normal.x + away.y * normal.y >= 0 ? normal : { x: -normal.x, y: -normal.y };
}

/** The outward normal of the house wall nearest a point, or `null` when none resolves. */
function nearestWallNormal(site: SiteSection, at: Point): Point | null {
  const { house } = site;
  if (!house) return null;

  const corners = housePolygon(house);
  const walls = houseWalls(house);
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const [index, wall] of walls.entries()) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    if (!a || !b) continue;
    const distance = distanceToSegment(at, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wall.id;
    }
  }

  return best === null ? null : wallNormal(house, best);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function wallLabel(descriptor: SideDescriptor | null): string | null {
  return descriptor ? WALL_DESCRIPTORS[descriptor] : null;
}
