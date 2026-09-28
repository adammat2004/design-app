import {
  distanceToEdge,
  elementArea,
  geometryOutline,
  isStructuralRole,
  samplePlanting,
  schemeFor,
  symbolForLayer,
  polygonContainsPolygon,
  polygonsIntersect,
  SYMBOLS,
  type DesignElement,
  type PlanGeometry,
  type Point,
  type SymbolId,
} from '@garden-studio/schema';
import type { DesignConstraints } from '../constraints.js';
import type { PlacementService } from '../placement.service.js';
import { placeable } from './placeable.js';

/**
 * A ceiling on the structural plants one concept places, and a floor under it per bed.
 *
 * The sampler is a *drawn density* — it will happily return forty backdrop shrubs for a large
 * border, which is the right answer for a texture and the wrong one for a list of objects the user
 * has to scroll.
 *
 * **Scaled by how much planting there is, rather than a flat thirty.** A flat cap is a cap on the
 * whole plan, so a garden with four deep borders spent it on the first two and left the last ones
 * as bare texture — the beds furthest from the house, which is where the structure matters most.
 * One shrub per five square metres of bed is roughly what a designer specifies for a mixed border,
 * and the hard ceiling stays because the panel still has to be scrollable.
 */
const METRES_PER_STRUCTURAL_PLANT = 5;
const MIN_STRUCTURAL_PLANTS = 12;
const MAX_STRUCTURAL_PLANTS = 60;

/** How many placed shrubs this much planting should carry. */
function structuralBudget(plantedArea: number): number {
  return Math.max(
    MIN_STRUCTURAL_PLANTS,
    Math.min(MAX_STRUCTURAL_PLANTS, Math.round(plantedArea / METRES_PER_STRUCTURAL_PLANT)),
  );
}

export interface StructureContext {
  constraints: DesignConstraints;
  /** What a shrub must clear. Grown by every shrub placed, as the caller's list always was. */
  obstacles: Point[][];
  houseRing: Point[] | null;
  boundary: Point[];
  scopePolygon: Point[] | null;
  nextId: () => string;
  placement: PlacementService;
  houseCentre: Point | null;
  /** The next seed in the generation's own sequence, so the sampler draws what it always drew. */
  nextSeed: () => number;
}

/**
 * The structural planting, placed as real elements on top of the beds in `elements`.
 *
 * The scheme's own `backdrop` and `specimen` layers, drawn from `samplePlanting` — the same function,
 * seed and drift the painter uses for the infill — so a shrub stands where the texture would have
 * drawn one. Then one evergreen anchor in any bed left empty. Placed rather than painted because a
 * border's structure is what a designer positions and a user needs to move.
 */
export async function plantStructure(
  elements: DesignElement[],
  context: StructureContext,
): Promise<DesignElement[]> {
  const specimens: DesignElement[] = [];
  const plantedBeds = elements.filter(
    (element) =>
      element.role === 'fill' &&
      element.fillKind === 'accent' &&
      element.category === 'planting-bed' &&
      element.shape.kind === 'polygon' &&
      element.material !== 'hedging',
  );

  /* Read once from what was actually drawn, so a garden of borders carries a garden's structure. */
  const structuralCap = structuralBudget(
    plantedBeds.reduce((total, bed) => total + elementArea(bed), 0),
  );

  for (const bed of plantedBeds) {
    if (bed.shape.kind !== 'polygon') continue;

    const outline = geometryOutline(bed.shape);
    const scheme = schemeFor(context.constraints.plantingStyle, bed.material);

    for (const layer of scheme.layers) {
      if (!isStructuralRole(layer.role)) continue;

      for (const placement of samplePlanting(outline, layer, bed.id)) {
        if (specimens.length >= structuralCap) break;

        // The plant's own variant picks its species, so a backdrop is a few kinds and not one.
        const symbol = symbolForLayer(layer, placement.variant) as SymbolId;
        const spec = SYMBOLS[symbol];
        const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.6;

        /*
         * Eroded by the plant's own radius, which the sampler does not do: it places a *point*
         * inside the outline, and a 0.6 m shrub centred a hand's breadth from the edge hangs over
         * onto the lawn. The old PostGIS path got this free by buffering the zone inward before
         * sampling; here it is an explicit test, and it has to be — the bed is what owns the
         * plant, and a shrub half on the grass belongs to neither.
         */
        if (distanceToEdge(placement.at, outline) < radius) continue;

        const shape: PlanGeometry = { kind: 'point', at: placement.at, radius };
        const ring = geometryOutline(shape);

        /*
         * The same legality every placed thing goes through, and the same obstacle set — a bed is
         * laid *under* the features standing in it, so "inside this bed" does not mean "clear of
         * everything" and a shrub could otherwise be planted through the shed.
         */
        if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) continue;
        if (context.obstacles.some((obstacle) => polygonsIntersect(ring, obstacle))) continue;

        context.obstacles.push(ring);

        specimens.push({
          id: context.nextId(),
          category: 'planting-bed',
          role: 'feature',
          name: spec.label,
          shape,
          zone: bed.zone,
          material: 'shrubs',
          bedId: bed.id,
          symbol,
          height: spec.height,
        });
      }
    }
  }

  // Sparse structural layers can miss a narrow border. Give each empty bed one deliberate
  // evergreen anchor, choosing the greatest clearance from its edge rather than a random point.
  for (const bed of plantedBeds) {
    if (specimens.length >= structuralCap) break;
    if (specimens.some((plant) => plant.bedId === bed.id)) continue;
    const outline = geometryOutline(bed.shape);
    const symbol: SymbolId = 'shrub-evergreen';
    const spec = SYMBOLS[symbol];
    const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.6;
    const candidates = await context.placement.candidates({
      zone: outline,
      obstacles: context.obstacles,
      inradius: radius,
      houseCentre: context.houseCentre,
      affinity: 'any',
      seed: context.nextSeed(),
    });
    const anchors = [...candidates].sort(
      (a, b) => distanceToEdge(b, outline) - distanceToEdge(a, outline),
    );
    for (const at of anchors) {
      const shape: PlanGeometry = { kind: 'point', at, radius };
      const ring = geometryOutline(shape);
      if (
        !polygonContainsPolygon(outline, ring) ||
        !placeable(shape, context.houseRing, context.boundary, context.scopePolygon) ||
        context.obstacles.some((obstacle) => polygonsIntersect(ring, obstacle))
      )
        continue;
      specimens.push({
        id: context.nextId(),
        category: 'planting-bed',
        role: 'feature',
        name: spec.label,
        shape,
        zone: bed.zone,
        material: 'shrubs',
        bedId: bed.id,
        symbol,
        height: spec.height,
      });
      context.obstacles.push(ring);
      break;
    }
  }

  return specimens;
}
