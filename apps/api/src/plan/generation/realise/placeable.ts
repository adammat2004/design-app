import {
  geometryClearsHouse,
  geometryFitsInside,
  geometryIsLegal,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';

/**
 * The generator's own placement rule: legal to save, clear of the house, **and** inside the
 * redesign area the user drew.
 *
 * `geometryIsLegal` is containment alone, because a user may attach a patio to the back wall.
 * The generator may not: it composes a whole garden at once, and a terrace or a border laid
 * across the footprint would be drawn over by the house and read as ground the design lost. So
 * the house rule lives here, at the generator's edge, rather than in the shared predicate.
 *
 * The redesign area is here for exactly the same reason. It is a rule about what the *generator*
 * may compose, not about what is legal — a user may drag a bed outside their own drawn area
 * afterwards and the editor has to let them. `scope` is `null` when no area was drawn, and the
 * check is then skipped rather than widened to the plot: widening it would re-tessellate the
 * boundary and move coordinates on every plan that never asked for a scope.
 */
export function placeable(
  geometry: PlanGeometry,
  houseRing: Point[] | null,
  boundary: Point[],
  scope: Point[] | null,
): boolean {
  return (
    geometryIsLegal(geometry, boundary) &&
    geometryClearsHouse(geometry, houseRing) &&
    (scope === null || geometryFitsInside(geometry, scope))
  );
}
