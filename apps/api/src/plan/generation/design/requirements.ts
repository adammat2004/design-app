import {
  isAtLeast,
  type DesiredFeature,
  type GardenBrief,
  type GardenIntent,
  type PriorityTier,
} from '@garden-studio/schema';
import type { DesignConstraints } from '../constraints.js';
import { FEATURE_LIBRARY, tierFor } from '../knowledge/feature-library.js';
import type { Requirements, SiteAnalysis } from './types.js';

/**
 * What the user actually wants, read out of the brief rather than taken from it literally.
 *
 * The brief is a set of ticks, and the generator has always treated them as equal: `featureAttempts`
 * computed how many would fit and then cut the list **in the order it was ticked**, so a fire pit
 * chosen before a terrace could displace the terrace. That is not a budgeting bug, it is the
 * absence of any model of what the garden is *for*.
 *
 * Two things happen here. The garden's `intent` is inferred from what was asked for, and every
 * requested feature is given a tier against that intent — so an entertaining garden's dining area
 * is essential and its shed is optional, while a family garden ranks them the other way round. What
 * gets dropped when the plot cannot hold everything is then the least wanted thing rather than the
 * last ticked one, and the concept can say why.
 *
 * Deterministic and pure. A model may later *revise* the intent and the tiers from the brief's
 * prose — that is exactly what the strategic-brief call is for — but this is the answer it revises,
 * and the answer the system falls back to with no key, no network and no budget.
 */

/**
 * How many placed features a garden of each scale band can carry, before the budget adjusts it.
 *
 * Replaces `featureAttempts`'s multiplier on the *requested count*, which had the odd property that
 * asking for more made more fit. Capacity is a fact about the plot: a courtyard holds two built
 * things well and four badly, whatever was ticked.
 */
const BAND_CAPACITY: Record<DesignConstraints['scale']['band'], number> = {
  courtyard: 2,
  suburban: 5,
  large: 7,
  estate: 9,
};

/**
 * Words in the brief's prose that point at an intent.
 *
 * The prose has never been read by anything — `brief.purpose` is captured on step 3 and consumed
 * nowhere, which TODOS records as an open limitation of the slot table. This is a small, honest
 * use of it: a keyword raises an intent's score, it never overrides the features, and every word
 * that matched is kept on `keywords` so the explanation can say what it read.
 *
 * Deliberately not a classifier. The features are the strong signal; the prose breaks ties.
 */
const PROSE_HINTS: Record<GardenIntent, string[]> = {
  entertaining: ['entertain', 'guests', 'party', 'parties', 'friends', 'barbecue', 'bbq', 'host'],
  family: ['children', 'child', 'kids', 'family', 'play', 'football', 'dog', 'toddler'],
  relaxation: ['relax', 'quiet', 'peaceful', 'calm', 'retreat', 'escape', 'unwind', 'sanctuary'],
  gardening: [
    'grow',
    'growing',
    'vegetables',
    'veg',
    'allotment',
    'compost',
    'cutting',
    'propagat',
  ],
  lowMaintenance: ['low maintenance', 'easy', 'no time', 'busy', 'upkeep', 'minimal', 'hassle'],
  showcase: ['impress', 'show', 'striking', 'statement', 'wow', 'design-led', 'architectural'],
  mixed: [],
};

/**
 * How strongly each requested feature votes for an intent.
 *
 * The votes are what the features *mean*, not what the feature library's tiers say — those are the
 * reverse lookup ("given this intent, how much do I want this?") and using them here would make the
 * inference circular.
 */
const FEATURE_VOTES: Partial<Record<DesiredFeature, Partial<Record<GardenIntent, number>>>> = {
  dining: { entertaining: 3, family: 1 },
  outdoorKitchen: { entertaining: 3 },
  pergola: { entertaining: 2, showcase: 1 },
  firePit: { entertaining: 2, relaxation: 1 },
  play: { family: 4 },
  lawn: { family: 2, relaxation: 1 },
  hotTub: { relaxation: 3 },
  gardenRoom: { relaxation: 2, showcase: 2 },
  water: { showcase: 3, relaxation: 2 },
  vegPatch: { gardening: 4 },
  greenhouse: { gardening: 4 },
  plantingBeds: { gardening: 2, showcase: 2 },
  seating: { relaxation: 1, entertaining: 1 },
  storage: { family: 1, gardening: 1 },
  lighting: { entertaining: 1, showcase: 1 },
};

export function interpretRequirements(
  brief: GardenBrief,
  analysis: SiteAnalysis,
  constraints: DesignConstraints,
): Requirements {
  const { intent, keywords } = inferIntent(brief);

  const priorities = brief.desiredFeatures.map((feature) => {
    const tier = resolveTier(feature, intent, brief);
    return { feature, tier, reason: reasonFor(feature, tier, intent) };
  });

  /* Essentials first, then preferred, then optional; ties keep the order the brief listed them. */
  priorities.sort((a, b) => rank(b.tier) - rank(a.tier));

  return {
    intent,
    priorities,
    capacity: capacityFor(constraints, analysis),
    keywords,
    constraints,
  };
}

/**
 * What this garden is for.
 *
 * Voted for by the features asked for, nudged by the prose, and `mixed` when nothing wins clearly —
 * which is an honest answer rather than a failure to decide, and the one that leaves the tiers flat
 * so nothing is starved.
 */
export function inferIntent(brief: GardenBrief): { intent: GardenIntent; keywords: string[] } {
  const scores = new Map<GardenIntent, number>();
  const bump = (intent: GardenIntent, by: number) =>
    scores.set(intent, (scores.get(intent) ?? 0) + by);

  for (const feature of brief.desiredFeatures) {
    for (const [intent, weight] of Object.entries(FEATURE_VOTES[feature] ?? {})) {
      bump(intent as GardenIntent, weight);
    }
  }

  const prose = brief.purpose.toLowerCase();
  const keywords: string[] = [];
  for (const [intent, words] of Object.entries(PROSE_HINTS) as [GardenIntent, string[]][]) {
    for (const word of words) {
      if (!prose.includes(word)) continue;
      keywords.push(word);
      bump(intent, 2);
    }
  }

  /*
   * The maintenance answer is a stated intent rather than an inferred one, so it counts for as much
   * as two features. It does not *win* outright: somebody can want a low-upkeep family garden, and
   * the play area still has to be essential in it.
   */
  if (brief.maintenance === 'low' || brief.style === 'lowMaintenance') bump('lowMaintenance', 3);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];

  // A win by less than two votes is not a win: a garden that is equally two things is mixed.
  if (!top || top[1] < 3 || (second && top[1] - second[1] < 2)) {
    return { intent: 'mixed', keywords };
  }
  return { intent: top[0], keywords };
}

/**
 * How badly this garden wants this feature.
 *
 * The library's per-intent table, with two overrides that are facts about the brief rather than
 * about the intent: a garden with nowhere at all to sit is not a garden, and a feature the user
 * typed in themselves under "something else" is not something to rank low on a guess.
 */
function resolveTier(
  feature: DesiredFeature,
  intent: GardenIntent,
  brief: GardenBrief,
): PriorityTier {
  if (feature === 'other') return 'preferred';

  const tier = tierFor(feature, intent);

  /*
   * Seating is essential whenever nothing else provides somewhere to sit. A brief that asked only
   * for dining has its dining area as the terrace — `build` already collapses the two — so this
   * only fires when neither was asked for, which is the case the terrace rule quietly covers.
   */
  if (feature === 'seating' && !brief.desiredFeatures.includes('dining')) return 'essential';

  return tier;
}

function reasonFor(feature: DesiredFeature, tier: PriorityTier, intent: GardenIntent): string {
  const zone = FEATURE_LIBRARY[feature].zone;
  if (tier === 'essential')
    return `A ${intentLabel(intent)} garden is not one without the ${zone}.`;
  if (tier === 'preferred')
    return `Wanted, and dropped only if the ${zone} cannot be fitted properly.`;
  return `Included where there is room after the rest of the garden works.`;
}

function rank(tier: PriorityTier): number {
  return isAtLeast(tier, 'essential') ? 2 : isAtLeast(tier, 'preferred') ? 1 : 0;
}

/**
 * How many placed features this plot can carry.
 *
 * The plot's band decides, the budget adjusts it by one either way, and the composed three never
 * count — a lawn and a planting scheme are passes that would run anyway, and counting them would
 * have a brief that ticked both quietly starve two real features out of the plan, which is the
 * reasoning `COMPOSED_FEATURES` already records.
 */
export function capacityFor(constraints: DesignConstraints, analysis: SiteAnalysis): number {
  const base = BAND_CAPACITY[constraints.scale.band];
  const budget = constraints.budget === 'low' ? -1 : constraints.budget === 'premium' ? 1 : 0;

  /*
   * A plot with no room to compose in has no capacity claim to make: everything falls to the
   * sampler, which places what it can find space for and reports the rest. Leaving the band's
   * number in place there would exclude features on a plot that might well have held them.
   */
  const roomless = analysis.room === null ? 1 : 0;

  return Math.max(1, base + budget + roomless);
}

/** The features to place, in priority order, cut to what the plot can carry. */
export function withinCapacity(requirements: Requirements): {
  keep: DesiredFeature[];
  cut: { feature: DesiredFeature; reason: string }[];
} {
  const placed = requirements.priorities.filter(
    (entry) => !FEATURE_LIBRARY[entry.feature].composed,
  );

  const keep: DesiredFeature[] = [];
  const cut: { feature: DesiredFeature; reason: string }[] = [];

  for (const entry of placed) {
    /*
     * An essential is never cut by capacity. If it genuinely will not fit, the layout says so and
     * the concept is capped by the `featureFit` gate — which is the honest report, where silently
     * dropping the thing the garden is for would not be.
     */
    if (keep.length < requirements.capacity || entry.tier === 'essential') {
      keep.push(entry.feature);
      continue;
    }
    cut.push({
      feature: entry.feature,
      reason: `There is not room for ${requirements.priorities.length} separate areas in a garden this size without crowding the ones that matter most.`,
    });
  }

  return { keep, cut };
}

function intentLabel(intent: GardenIntent): string {
  switch (intent) {
    case 'lowMaintenance':
      return 'low-upkeep';
    case 'showcase':
      return 'show';
    case 'mixed':
      return 'family';
    default:
      return intent;
  }
}
