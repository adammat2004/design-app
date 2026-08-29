import { z } from 'zod';

/**
 * What a door or a window *is*, as data — and nothing about where it lands.
 *
 * A leaf module, for exactly the reason `zone-id.ts` is one. `site.ts` has to know this schema to
 * put an `openings` array on the house, and the resolvers in `openings.ts` have to know
 * `housePolygon` to turn an opening into coordinates. Keeping the schema here breaks what would
 * otherwise be a direct cycle between the two — the kind that only fails under one module
 * evaluation order, which is the worst sort of bug to chase.
 *
 * The header of `openings.ts` covers the geometry; what matters here is that an opening is
 * parameterised on a **wall id and a distance along it**, never on a coordinate. That is what makes
 * it survive the house being moved, rotated or resized, and it is the same reason a boundary vertex
 * carries an id.
 */

/**
 * The kinds that have different design consequences. Anything finer is a distinction the generator
 * could not act on.
 *
 * `patio-door` is the single most layout-determining object in a residential garden — the terrace
 * goes in front of it, the main path starts at it, and without one the generator is guessing. The
 * rest earn their place by what they forbid or attract: a `back-door` wants a utility route to the
 * bins, a `window` projects a view worth keeping clear, an `upper-window` does neither at ground
 * level but still overlooks a neighbour.
 */
export const OpeningTypeSchema = z.enum([
  'patio-door',
  'back-door',
  'front-door',
  'window',
  'upper-window',
  'garage-door',
]);
export type OpeningType = z.infer<typeof OpeningTypeSchema>;

/** Hinged doors sweep an arc that has to stay clear; sliding and bifold ones do not. */
export const SwingSchema = z.enum(['none', 'inward', 'outward']);
export type Swing = z.infer<typeof SwingSchema>;

export const OpeningSchema = z.object({
  id: z.string(),
  /** The wall this sits on, by `HouseWall.id` — never by position in the outline. */
  wallId: z.string(),
  /** Metres from the wall's start corner to the opening's **centre**. */
  offsetAlongEdge: z.number().nonnegative(),
  width: z.number().positive(),
  type: OpeningTypeSchema,
  /**
   * Metres above the floor. Zero for a door, which is what makes "is this a threshold" a fact
   * about the geometry rather than a second flag that could disagree with the type.
   */
  sillHeight: z.number().nonnegative().default(0),
  /** Storey. 0 is the ground floor, and only the ground floor opens onto the garden. */
  floorLevel: z.number().int().nonnegative().default(0),
  swing: SwingSchema.default('none'),
});
export type Opening = z.infer<typeof OpeningSchema>;

/** The types you can walk through. */
const DOOR_TYPES: OpeningType[] = ['patio-door', 'back-door', 'front-door', 'garage-door'];

export function isDoor(opening: Opening): boolean {
  return DOOR_TYPES.includes(opening.type);
}

/** Only the ground floor opens onto the garden — an upstairs door is a balcony problem. */
export function isGroundFloor(opening: Opening): boolean {
  return opening.floorLevel === 0;
}

/**
 * A door you can actually step out of. The circulation graph's required nodes, and the only
 * openings that generate a threshold keep-clear.
 */
export function isGardenDoor(opening: Opening): boolean {
  return isDoor(opening) && isGroundFloor(opening);
}

/** Windows at ground level, which are what a view cone is projected from. */
export function isGroundWindow(opening: Opening): boolean {
  return opening.type === 'window' && isGroundFloor(opening);
}

/**
 * How deep the keep-clear rectangle in front of a door runs, in metres.
 *
 * Enough to open the door, stand on the threshold and turn — and deliberately not a planting rule
 * dressed up as a clearance. Paving and lawn are welcome here; what must not be is a bed or a
 * water feature, which is what makes this a constraint on *some* categories rather than a hole in
 * the design.
 */
export const THRESHOLD_DEPTH = 1.8;

/**
 * Which walls can hold which openings. A party wall is somebody else's house.
 *
 * Keyed by `string` rather than by `WallKind`, which lives in `site.ts` — importing it here would
 * put the cycle back that this leaf module exists to break. `canWallHold` in `openings.ts` takes
 * the typed argument and looks up safely, so the looseness stops at this file's edge.
 */
export const OPENINGS_BY_WALL: Record<string, OpeningType[] | 'all'> = {
  external: 'all',
  party: [],
  garage: ['garage-door'],
};

/**
 * What each sort of opening is, before the user adjusts it. Real product sizes, so the default is
 * a statement rather than a placeholder: 2.4 m of bifolds, a 900 mm back door, a 1.2 m window at
 * standard sill height.
 */
export const OPENING_DEFAULTS: Record<
  OpeningType,
  Omit<Opening, 'id' | 'wallId' | 'offsetAlongEdge'>
> = {
  'patio-door': { width: 2.4, type: 'patio-door', sillHeight: 0, floorLevel: 0, swing: 'none' },
  'back-door': { width: 0.9, type: 'back-door', sillHeight: 0, floorLevel: 0, swing: 'inward' },
  'front-door': { width: 0.9, type: 'front-door', sillHeight: 0, floorLevel: 0, swing: 'inward' },
  window: { width: 1.2, type: 'window', sillHeight: 0.9, floorLevel: 0, swing: 'none' },
  'upper-window': {
    width: 1.2,
    type: 'upper-window',
    sillHeight: 0.9,
    floorLevel: 1,
    swing: 'none',
  },
  'garage-door': { width: 2.4, type: 'garage-door', sillHeight: 0, floorLevel: 0, swing: 'none' },
};

export const OPENING_LABELS: Record<OpeningType, string> = {
  'patio-door': 'Patio doors',
  'back-door': 'Back door',
  'front-door': 'Front door',
  window: 'Window',
  'upper-window': 'Upstairs window',
  'garage-door': 'Garage door',
};

export const WALL_KIND_LABELS: Record<string, string> = {
  external: 'External',
  party: 'Party wall',
  garage: 'Attached garage',
};

/** A storey, in metres — the strip draws blocks against this so the proportions read true. */
export const STOREY_HEIGHT = 2.7;

/** How tall each sort of opening is, for the elevation strip. Doors run to the floor. */
export const OPENING_HEIGHTS: Record<OpeningType, number> = {
  'patio-door': 2.1,
  'back-door': 2.0,
  'front-door': 2.0,
  window: 1.2,
  'upper-window': 1.2,
  'garage-door': 2.1,
};
