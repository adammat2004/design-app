import { z } from 'zod';

/**
 * A leaf module on purpose. `site.ts` needs the zone id for `selectedZoneIds`, and `zones.ts`
 * needs the house footprint from `site.ts` to derive the zones — importing each other directly
 * would be a cycle that only breaks under one module evaluation order, which is the worst kind.
 */
export const ZoneIdSchema = z.enum(['front', 'back', 'left', 'right']);
export type ZoneId = z.infer<typeof ZoneIdSchema>;

/** Stable display order for the Design areas checklist, independent of geometry. */
export const ZONE_ORDER: ZoneId[] = ['front', 'back', 'left', 'right'];
