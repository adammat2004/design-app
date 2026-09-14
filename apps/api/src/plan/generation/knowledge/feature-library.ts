import {
  type DesiredFeature,
  type FunctionalZoneType,
  type GardenIntent,
  type PriorityTier,
} from '@garden-studio/schema';
import { FEATURE_SPECS, REPEATABLE_FEATURES, type FeatureSpec } from '../archetypes.js';
import { hostFloor } from '../furnishings.js';
import type { Footprint } from '../layout/fit.js';
import type { SlotKind } from '../layout/sketch.js';

/**
 * What the generator knows about each thing a brief can ask for.
 *
 * `FEATURE_SPECS` in `archetypes.ts` says how big a thing is, what category it lands in and whether
 * it likes being near the house. That was the whole of the generator's knowledge, and it is why a
 * pergola was "whatever fits the terrace-end slot" rather than "part of the dining room". This
 * table is the rest of it: which functional zone the feature belongs to, how badly each kind of
 * garden wants it, how much space it needs round it, what it must be able to reach, and whether it
 * should be visible from the house or hidden from it.
 *
 * **It composes `FEATURE_SPECS` rather than replacing it.** Dimensions stay in one place — a test
 * asserts `spec === FEATURE_SPECS[feature]` by identity — so there is no second manifest to drift.
 * What is added here is behaviour, not measurement.
 *
 * Declarative on purpose. Every rule in it is a row somebody can read and argue with, which is the
 * difference between a knowledge system and a pile of `if` statements: adding a garden feature is
 * an entry here, not a branch in the placer.
 */

/** How a feature sits inside its zone, which is what a slot kind actually encodes. */
export type WithinZone = 'core' | 'end' | 'edge' | 'corner';

export interface FeatureKnowledge {
  /** The identical object from `FEATURE_SPECS`. Never a copy — the test pins that. */
  spec: FeatureSpec;
  /**
   * The least this may be and still be the thing that was asked for.
   *
   * Derived from what it holds wherever it holds something, through `hostFloor`, so a terrace's
   * floor moves when the furnishing list does. A shed's floor is a shed you can get a mower into.
   */
  minSize: Footprint;
  /** The room in the garden this belongs to. */
  zone: FunctionalZoneType;
  withinZone: WithinZone;
  /**
   * The slots it is tried in, best first — today's `PREFERENCES` table, moved here so a feature's
   * placement sits beside everything else known about it. The zone chooses first; this is the
   * ladder down when the zone's own slot is taken or does not exist on this archetype.
   */
  placement: SlotKind[];
  /** Metres of clear ground it wants round it, beyond what legality requires. */
  clearance: number;
  /** What it has to be reachable from. A shed nobody can wheel a bin to is not a shed. */
  access: 'house' | 'gate' | 'any';
  /** Whether it wants to be seen from the garden doors, hidden from them, or does not care. */
  visibility: 'wants' | 'avoids' | 'neutral';
  boundaryAffinity: 'prefers' | 'avoids' | 'neutral';
  /** Whether a large plot may have two. Mirrors `REPEATABLE_FEATURES`; pinned by a test. */
  repeatable: boolean;
  /**
   * Whether it is drawn by a pass rather than placed in a slot — the lawn, the borders, the
   * lighting. Composed features consume none of the placement capacity and are reported from what
   * actually landed.
   */
  composed: boolean;
  /**
   * How badly each kind of garden wants it. Absent means the intent has no opinion and the feature
   * falls to the default tier for a thing the user ticked, which is `preferred`.
   *
   * This is the table that makes "the user primarily wants an entertaining garden" mean something:
   * it is what turns a flat list of ticks into an order, and therefore what decides which feature
   * is dropped when the plot cannot hold them all.
   */
  intents: Partial<Record<GardenIntent, PriorityTier>>;
}

/** A feature the user ticked but no intent ranks: wanted, not essential. */
export const DEFAULT_TIER: PriorityTier = 'preferred';

function knows(
  feature: DesiredFeature,
  entry: Omit<FeatureKnowledge, 'spec' | 'repeatable' | 'minSize'> & { minSize?: Footprint },
): FeatureKnowledge {
  const spec = FEATURE_SPECS[feature];
  return {
    spec,
    minSize: entry.minSize ?? floorFor(feature, spec),
    repeatable: REPEATABLE_FEATURES.includes(feature),
    ...entry,
  };
}

/**
 * The floor for a feature that holds furniture, else six tenths of its own footprint.
 *
 * The fraction matches `fit.ts`'s `MIN_SCALE`: below that the placer already refuses to shrink, so
 * declaring anything smaller would be a floor nothing could reach. Where a feature *does* hold
 * something, the thing it holds decides — which is the rule `TERRACE_FLOOR` already follows.
 */
function floorFor(feature: DesiredFeature, spec: FeatureSpec): Footprint {
  const held = hostFloor(feature, 'smallest');
  if (held.width > 0 && held.depth > 0) return { kind: 'rect', ...held };
  return spec.footprint.kind === 'point'
    ? { kind: 'point', radius: spec.footprint.radius * 0.6 }
    : { kind: 'rect', width: spec.footprint.width * 0.6, depth: spec.footprint.depth * 0.6 };
}

/**
 * Every feature, with what the designer knows about it.
 *
 * Total by construction, so adding a `DesiredFeature` is a compile error here — the fifth exhaustive
 * record, alongside `DESIRED_FEATURE_LABELS`, `FEATURE_SPECS`, the slot preferences and the web's
 * icon map. That is the mechanism keeping a card on step 3 from being a tick the design ignores.
 */
export const FEATURE_LIBRARY: Record<DesiredFeature, FeatureKnowledge> = {
  seating: knows('seating', {
    zone: 'terrace',
    withinZone: 'core',
    placement: ['terrace'],
    clearance: 0,
    access: 'house',
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: false,
    // Somewhere to sit is the one thing every garden is for; only a working garden ranks it lower.
    intents: {
      entertaining: 'essential',
      relaxation: 'essential',
      family: 'essential',
      showcase: 'preferred',
      lowMaintenance: 'preferred',
      gardening: 'preferred',
      mixed: 'essential',
    },
  }),

  dining: knows('dining', {
    /*
     * Its own room rather than part of the terrace, which is the whole reason `dining` was split
     * out of `seating`: a brief asking for both used to get one patio with a sofa on it.
     */
    zone: 'dining',
    withinZone: 'end',
    placement: ['terrace-end', 'beside-terrace', 'far-room', 'lawn-far'],
    clearance: 0.6,
    access: 'house',
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: { entertaining: 'essential', family: 'preferred', mixed: 'preferred' },
  }),

  pergola: knows('pergola', {
    // A pergola is a roof over somewhere you eat. It belongs to the dining room, not beside it.
    zone: 'dining',
    withinZone: 'end',
    placement: ['terrace-end', 'axis-end', 'far-room'],
    clearance: 0.4,
    access: 'house',
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: { entertaining: 'preferred', showcase: 'preferred', relaxation: 'optional' },
  }),

  outdoorKitchen: knows('outdoorKitchen', {
    zone: 'dining',
    withinZone: 'edge',
    placement: ['beside-terrace'],
    clearance: 0.9,
    /*
     * Carried out of the kitchen, so it stays within reach of the house — and it must not be in the
     * way, which is why `clearance` is the largest of any small feature: you stand in front of a
     * barbecue with your back to the route past it.
     */
    access: 'house',
    visibility: 'neutral',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: { entertaining: 'essential', family: 'optional' },
  }),

  hotTub: knows('hotTub', {
    // Used in the dark and in a dressing gown, so it stays within reach of the door.
    zone: 'terrace',
    withinZone: 'corner',
    placement: ['terrace-corner', 'beside-terrace', 'far-room'],
    clearance: 0.6,
    access: 'house',
    visibility: 'neutral',
    boundaryAffinity: 'prefers',
    composed: false,
    intents: { relaxation: 'preferred', entertaining: 'optional' },
  }),

  firePit: knows('firePit', {
    zone: 'destination',
    withinZone: 'core',
    placement: ['far-room', 'lawn-far', 'axis-end'],
    clearance: 1.2,
    access: 'any',
    visibility: 'wants',
    boundaryAffinity: 'avoids',
    composed: false,
    intents: { entertaining: 'preferred', relaxation: 'preferred', family: 'optional' },
  }),

  play: knows('play', {
    zone: 'play',
    withinZone: 'end',
    placement: ['lawn-far', 'far-room'],
    clearance: 1,
    access: 'any',
    /*
     * The one feature whose visibility is a safety claim rather than a preference: a play area you
     * cannot see from the kitchen window is a play area nobody uses.
     */
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: { family: 'essential', mixed: 'preferred' },
  }),

  storage: knows('storage', {
    zone: 'utility',
    withinZone: 'core',
    placement: ['utility', 'utility-2'],
    clearance: 0.3,
    // The bins and the mower come in from the street, so a shed belongs where you can reach it.
    access: 'gate',
    visibility: 'avoids',
    boundaryAffinity: 'prefers',
    composed: false,
    intents: {
      family: 'preferred',
      gardening: 'essential',
      lowMaintenance: 'preferred',
      mixed: 'preferred',
    },
  }),

  vegPatch: knows('vegPatch', {
    zone: 'productive',
    withinZone: 'edge',
    placement: ['utility-2', 'utility', 'lawn-far'],
    clearance: 0.6,
    access: 'any',
    visibility: 'neutral',
    boundaryAffinity: 'prefers',
    composed: false,
    intents: { gardening: 'essential', family: 'optional' },
  }),

  greenhouse: knows('greenhouse', {
    // Worked in rather than sat in: it belongs with the beds and the shed.
    zone: 'productive',
    withinZone: 'edge',
    placement: ['utility-2', 'utility', 'far-room'],
    clearance: 0.6,
    access: 'any',
    visibility: 'avoids',
    boundaryAffinity: 'prefers',
    composed: false,
    intents: { gardening: 'essential' },
  }),

  gardenRoom: knows('gardenRoom', {
    // A building you walk to: it takes the far room like the room it is.
    zone: 'destination',
    withinZone: 'core',
    placement: ['far-room', 'lawn-far', 'utility'],
    clearance: 0.8,
    access: 'house',
    visibility: 'neutral',
    boundaryAffinity: 'prefers',
    composed: false,
    intents: { showcase: 'preferred', relaxation: 'preferred', entertaining: 'optional' },
  }),

  water: knows('water', {
    zone: 'water',
    withinZone: 'end',
    placement: ['axis-end', 'terrace-corner', 'far-room'],
    clearance: 0.6,
    access: 'any',
    // The thing a formal axis terminates, and the thing you look at from the doors.
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: { showcase: 'essential', relaxation: 'preferred', gardening: 'optional' },
  }),

  /* ---- the three composed answers ---- */

  lawn: knows('lawn', {
    zone: 'lawn',
    withinZone: 'core',
    placement: ['lawn-far'],
    clearance: 0,
    access: 'any',
    visibility: 'wants',
    boundaryAffinity: 'neutral',
    composed: true,
    intents: { family: 'essential', relaxation: 'preferred', showcase: 'preferred' },
  }),

  plantingBeds: knows('plantingBeds', {
    zone: 'planting',
    withinZone: 'edge',
    placement: ['lawn-far', 'far-room'],
    clearance: 0,
    access: 'any',
    visibility: 'wants',
    boundaryAffinity: 'prefers',
    composed: true,
    intents: { gardening: 'essential', showcase: 'essential', relaxation: 'preferred' },
  }),

  lighting: knows('lighting', {
    zone: 'transition',
    withinZone: 'edge',
    placement: ['far-room'],
    clearance: 0,
    access: 'any',
    visibility: 'neutral',
    boundaryAffinity: 'neutral',
    composed: true,
    intents: { entertaining: 'preferred', showcase: 'preferred' },
  }),

  other: knows('other', {
    zone: 'destination',
    withinZone: 'core',
    placement: ['far-room', 'lawn-far', 'beside-terrace'],
    clearance: 0.4,
    access: 'any',
    visibility: 'neutral',
    boundaryAffinity: 'neutral',
    composed: false,
    intents: {},
  }),
};

export function knowledgeOf(feature: DesiredFeature): FeatureKnowledge {
  return FEATURE_LIBRARY[feature];
}

/** The features a zone type claims, in library order. */
export function featuresOfZone(zone: FunctionalZoneType): DesiredFeature[] {
  return (Object.keys(FEATURE_LIBRARY) as DesiredFeature[]).filter(
    (feature) => FEATURE_LIBRARY[feature].zone === zone,
  );
}

/** Which slots a feature may be tried in, best first. The successor to `slotPreferences`. */
export function placementLadder(feature: DesiredFeature): SlotKind[] {
  return FEATURE_LIBRARY[feature].placement;
}

/** How badly this kind of garden wants this feature, given that the user asked for it. */
export function tierFor(feature: DesiredFeature, intent: GardenIntent): PriorityTier {
  return FEATURE_LIBRARY[feature].intents[intent] ?? DEFAULT_TIER;
}

/** The features that are drawn by a pass rather than placed. Mirrors `COMPOSED_FEATURES`. */
export const COMPOSED: DesiredFeature[] = (Object.keys(FEATURE_LIBRARY) as DesiredFeature[]).filter(
  (feature) => FEATURE_LIBRARY[feature].composed,
);
