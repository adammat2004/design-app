import type { DesiredFeature, ElementCategory, MaterialId } from '@garden-studio/schema';
import { materialFor } from './archetypes.js';
import type { DesignConstraints } from './constraints.js';

/** Planner roles only: the resulting surfaces remain ordinary measured DesignElements. */
export type RoomPurpose = 'primary' | 'lounge' | 'fire' | 'utility';
export type RoutePurpose = 'access' | 'utility' | 'secondary';

export function roomSurface(
  purpose: RoomPurpose,
  constraints: DesignConstraints,
  index: number,
): { category: ElementCategory; material: MaterialId } {
  if (purpose === 'fire' || purpose === 'utility')
    return { category: 'gravel-mulch', material: 'decorative-gravel' };
  if (purpose === 'lounge' && constraints.budget !== 'low' && constraints.maintenance !== 'low')
    return { category: 'paved-area', material: 'timber-decking' };
  return { category: 'paved-area', material: materialFor('paved-area', constraints, index) };
}

/*
 * Routes are laid in setts, not in the terrace's slab.
 *
 * A path is where a coarse module shows worst: at 900 × 600 a 1.05 m route was barely one slab
 * wide, and even at 400 mm it is two and a half. Setts are what paths and drives are actually laid
 * in, and they give a route its own grain — which is how a drawn plan tells a path from a patio at
 * a glance, rather than by the width alone.
 */
export function circulationFor(
  purpose: RoutePurpose,
  constraints: DesignConstraints,
): { category: ElementCategory; material: MaterialId; width: number } {
  if (purpose === 'access') return { category: 'paved-area', material: 'stone-setts', width: 1.2 };
  if (purpose === 'utility')
    return constraints.style === 'formal'
      ? { category: 'paved-area', material: 'stone-setts', width: 1.05 }
      : { category: 'gravel-mulch', material: 'decorative-gravel', width: 1.05 };
  if (constraints.maintenance === 'low' || constraints.budget === 'low')
    return { category: 'gravel-mulch', material: 'decorative-gravel', width: 0.9 };
  return { category: 'paved-area', material: 'stepping-stones', width: 0.85 };
}

export function wantsLoungeRoom(
  features: DesiredFeature[],
  constraints: DesignConstraints,
): boolean {
  return (
    features.includes('seating') &&
    !features.includes('pergola') &&
    !features.includes('firePit') &&
    !features.includes('play') &&
    (constraints.budget === 'high' || constraints.budget === 'premium') &&
    constraints.scale.designedArea >= 120
  );
}
