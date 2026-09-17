import type { BriefEmphasis, DesiredFeature } from '@garden-studio/schema';

/**
 * How the things in a garden relate to each other, as data.
 *
 * The generator's entire model of intent used to be `FeatureSpec.affinity` — three values, and a
 * comment saying so: "a dining area wants to be near the house, a shed wants to be out of the way".
 * That is enough to stop a plan reading as scattered and nowhere near enough to make it read as
 * designed. A designed garden knows that the barbecue belongs *with* the dining, that the play area
 * has to be visible from the kitchen, that a hot tub should not be in view of the street, and that
 * a fire pit and a paddling-pool-aged child should not share a corner.
 *
 * Rules rather than code, deliberately. Every one of these is a row a landscape designer could read
 * and disagree with, and adding one is an entry rather than a branch. The evaluator turns them into
 * a score; the planner reads the same table when it decides which zone a feature joins, so the two
 * cannot hold different opinions about where a barbecue goes.
 *
 * **Nothing here places anything.** A rule is scored after the fact against real geometry, so a
 * relationship that cannot be satisfied on a particular plot costs the candidate points rather than
 * producing an illegal placement.
 */

/** The things a rule can be about, beyond the features themselves. */
export type RelationSubject = DesiredFeature | 'house' | 'gate' | 'lawn' | 'street';

export type RelationKind =
  /** Wants to be within `distance` metres. Scored on how far past it the pair actually is. */
  | 'preferNear'
  /** Must be within `distance`. Failing it is a major issue rather than a lost fraction. */
  | 'requireNear'
  /** Must be at least `distance` apart. Hazards. */
  | 'avoidNear'
  /** Should be inside the view cone from the garden doors. */
  | 'requireVisibleFrom'
  /** Should be outside it. */
  | 'avoidVisibleFrom';

/**
 * What kind of relationship this is, so an emphasis can weigh it.
 *
 * The four headings the table was already written under, made into data. A concept built round
 * eating outside genuinely cares more that the barbecue is by the table than that the greenhouse is
 * by the veg patch, and until this existed the scorer weighed the two identically on every plan.
 */
export type RelationGroup = 'dining' | 'utility' | 'family' | 'privacy' | 'productive';

export interface RelationshipRule {
  subject: RelationSubject;
  kind: RelationKind;
  object: RelationSubject;
  /** Metres. Required by the three distance kinds, meaningless to the two visibility ones. */
  distance?: number;
  /** How much of the relationships score this rule is worth, relative to the others that applied. */
  weight: number;
  /** Which group it belongs to, for the emphasis to weigh. */
  group: RelationGroup;
  /** Why, in the concept's own words. Quoted into the issue message and the explanation. */
  reason: string;
  /** What the issue is called when the rule is broken; `relationship-unmet` is the general case. */
  code?:
    | 'shed-in-view'
    | 'play-not-visible'
    | 'play-near-hazard'
    | 'bbq-far-from-dining'
    | 'relationship-unmet';
}

/**
 * The rules, in no particular order — the evaluator filters to the ones whose subject and object
 * are both present, so a garden with no play area simply never sees the play rules.
 *
 * Distances are what a person would actually accept, not what geometry makes convenient. Three
 * metres from the barbecue to the table is "you can hand a plate over". Four metres from the play
 * area to the fire pit is the distance at which a running child is not in the fire.
 */
export const RELATIONSHIP_RULES: RelationshipRule[] = [
  /* ---- the dining group ---- */
  {
    subject: 'pergola',
    kind: 'preferNear',
    object: 'dining',
    distance: 4,
    weight: 2,
    group: 'dining',
    reason: 'A pergola is a roof over the table rather than a structure on its own.',
  },
  {
    subject: 'pergola',
    kind: 'preferNear',
    object: 'seating',
    distance: 5,
    weight: 1,
    group: 'dining',
    reason: 'With nowhere to sit under it, a pergola is scenery.',
  },
  {
    subject: 'outdoorKitchen',
    kind: 'requireNear',
    object: 'dining',
    distance: 3,
    weight: 3,
    group: 'dining',
    reason: 'Food is carried from the grill to the table; three metres is the length of that walk.',
    code: 'bbq-far-from-dining',
  },
  {
    subject: 'outdoorKitchen',
    kind: 'preferNear',
    object: 'house',
    distance: 8,
    weight: 2,
    group: 'dining',
    reason: 'Everything else for a barbecue comes out of the kitchen.',
  },

  /* ---- the utility group ---- */
  {
    subject: 'storage',
    kind: 'avoidVisibleFrom',
    object: 'house',
    weight: 3,
    group: 'utility',
    reason: 'A shed in the middle of the view from the doors is the first thing a designer moves.',
    code: 'shed-in-view',
  },
  {
    subject: 'storage',
    kind: 'preferNear',
    object: 'gate',
    distance: 8,
    weight: 2,
    group: 'utility',
    reason:
      'The bins and the mower come in from the street, so the store belongs by the side gate.',
  },
  {
    subject: 'greenhouse',
    kind: 'preferNear',
    object: 'vegPatch',
    distance: 6,
    weight: 2,
    group: 'productive',
    reason: 'Seedlings are carried from the greenhouse to the beds; they are one working area.',
  },
  {
    subject: 'vegPatch',
    kind: 'preferNear',
    object: 'storage',
    distance: 10,
    weight: 1,
    group: 'productive',
    reason: 'The tools live in the shed.',
  },

  /* ---- family safety ---- */
  {
    subject: 'play',
    kind: 'requireVisibleFrom',
    object: 'house',
    weight: 3,
    group: 'family',
    reason: 'A play area you cannot see from the house is one nobody lets the children use.',
    code: 'play-not-visible',
  },
  {
    subject: 'play',
    kind: 'avoidNear',
    object: 'firePit',
    distance: 4,
    weight: 3,
    group: 'family',
    reason: 'A fire and a running child need to be further apart than a stride.',
    code: 'play-near-hazard',
  },
  {
    subject: 'play',
    kind: 'avoidNear',
    object: 'water',
    distance: 4,
    weight: 3,
    group: 'family',
    reason: 'Open water beside a play area is the one adjacency worth refusing outright.',
    code: 'play-near-hazard',
  },
  {
    subject: 'play',
    kind: 'preferNear',
    object: 'lawn',
    distance: 3,
    weight: 2,
    group: 'family',
    reason: 'Play spills onto the grass; an island of bark in the planting does not get used.',
  },

  /* ---- privacy and outlook ---- */
  {
    subject: 'hotTub',
    kind: 'avoidVisibleFrom',
    object: 'street',
    weight: 3,
    group: 'privacy',
    reason: 'A hot tub in view of the pavement is one that stays covered.',
  },
  {
    subject: 'hotTub',
    kind: 'preferNear',
    object: 'house',
    distance: 8,
    weight: 2,
    group: 'privacy',
    reason: 'You walk to it in a dressing gown, in the dark, in February.',
  },
  {
    subject: 'water',
    kind: 'requireVisibleFrom',
    object: 'house',
    weight: 2,
    group: 'privacy',
    reason: 'A water feature is something to look at; out of sight it is a maintenance job.',
  },
  {
    subject: 'gardenRoom',
    kind: 'avoidNear',
    object: 'house',
    distance: 4,
    weight: 2,
    group: 'privacy',
    reason: 'Against the back wall a garden room is an extension, which is a different project.',
  },
];

/**
 * How much more each emphasis cares about each group of rules.
 *
 * Deliberately sparse and deliberately narrow. Every rule still counts in every garden — a play area
 * beside a fire pit is dangerous whatever the concept is for — and what an emphasis changes is which
 * relationship it would fix first. Absent means one.
 */
export const EMPHASIS_RULE_WEIGHT: Record<BriefEmphasis, Partial<Record<RelationGroup, number>>> = {
  social: { dining: 1.5 },
  open: { family: 1.2 },
  planted: { privacy: 1.2 },
  productive: { productive: 1.5, utility: 1.2 },
};

/** What a rule is worth to a concept of this emphasis. */
export function ruleWeight(rule: RelationshipRule, emphasis: BriefEmphasis): number {
  return rule.weight * (EMPHASIS_RULE_WEIGHT[emphasis][rule.group] ?? 1);
}

/** Every rule that could apply to a garden containing these features. */
export function rulesFor(present: Set<RelationSubject>): RelationshipRule[] {
  return RELATIONSHIP_RULES.filter(
    (rule) =>
      present.has(rule.subject) &&
      (rule.kind === 'requireVisibleFrom' || rule.kind === 'avoidVisibleFrom'
        ? true
        : present.has(rule.object)),
  );
}
