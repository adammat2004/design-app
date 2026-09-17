import {
  DesignBriefSchema,
  type DesignBrief,
  type DesiredFeature,
  type FunctionalZoneType,
  type GardenBrief,
  type LayoutArchetypeId,
} from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import { rankArchetypes } from './archetype-selector.js';
import type { SiteAnalysis } from './types.js';

/**
 * Taking a model's strategic brief field by field, and keeping only what is true.
 *
 * The model is allowed to decide what the garden is *for*, which rooms matter, how the features rank
 * and which compositions are worth trying. It is not allowed to be wrong about what the user asked
 * for or about what the plot can hold, and the difference between those two is the whole of this
 * module.
 *
 * **Field by field, never all-or-nothing.** A single bad archetype in a shortlist is not a reason to
 * throw away a good reading of the intent; the shortlist is filtered and everything else stands. A
 * whole-envelope reject would mean one hallucinated feature id silently reverting the entire brief
 * to the deterministic one, and nothing downstream could tell that had happened.
 *
 * **The deterministic brief is the floor, not the ceiling.** Every field falls back to it, so the
 * worst case is the answer the generator would have produced anyway. That is what makes the model
 * safe to switch on: it can improve a brief and it cannot break one.
 *
 * **It is pure, and it lives here rather than in `assistant/`.** The interesting half of this
 * feature is testable with no model at all — feed it an envelope, assert what survives — which is
 * the same split `planner.service.test.ts` gets from `DesignIntent`.
 */

/** What the reconciler changed, so the log and the tests can say which fields the model won. */
export interface Reconciliation {
  briefs: DesignBrief[];
  /** Per brief slot, the field names taken from the model rather than from the fallback. */
  accepted: Record<string, string[]>;
  /** Human-readable notes on what was refused and why. Logged, never shown to a user. */
  refused: string[];
}

/**
 * How many features one brief may call essential.
 *
 * A brief where everything is essential has ranked nothing, and the capacity cut then has no
 * information to cut on — which is the state the whole priority layer exists to replace. Four is
 * what a suburban garden can actually carry as must-haves.
 */
const MAX_ESSENTIALS = 4;

export function reconcileBriefs(
  proposed: DesignBrief[],
  fallback: DesignBrief[],
  brief: GardenBrief,
  analysis: SiteAnalysis,
): Reconciliation {
  const requested = new Set<DesiredFeature>(brief.desiredFeatures);
  const accepted: Record<string, string[]> = {};
  const refused: string[] = [];

  const briefs = fallback.map((base) => {
    const match = proposed.find((candidate) => candidate.id === base.id);
    if (!match) {
      refused.push(`slot ${base.id}: the model returned no brief for it`);
      return base;
    }

    const won: string[] = [];
    const take = <K extends keyof DesignBrief>(field: K, value: DesignBrief[K] | null) => {
      if (value === null) return base[field];
      won.push(field);
      return value;
    };

    const merged: DesignBrief = {
      ...base,
      /*
       * The model's to decide outright. `intent` and `emphasis` are readings of what the user wants
       * rather than claims about the plot, and the enums already bound them — there is nothing to
       * check beyond the parse that got us here.
       */
      intent: take('intent', match.intent),
      emphasis: take('emphasis', match.emphasis),

      primaryZone: take('primaryZone', usableZone(match.primaryZone, requested)),
      secondaryZones: take('secondaryZones', usableZones(match.secondaryZones, requested)),
      supportingZones: take('supportingZones', usableZones(match.supportingZones, requested)),

      archetypeShortlist: take(
        'archetypeShortlist',
        viableArchetypes(match.archetypeShortlist, base, analysis, refused),
      ),

      circulation: take('circulation', match.circulation),
      focal: take('focal', match.focal),
      privacy: take('privacy', match.privacy),

      featurePriorities: take(
        'featurePriorities',
        askedFor(match.featurePriorities, requested, base.id, refused),
      ),
      excludedFeatures: take(
        'excludedFeatures',
        excludable(match.excludedFeatures, requested, base.id, refused),
      ),

      /*
       * The style is the user's own answer on a picture card. A model that overrode it would be
       * changing a stated preference into an inferred one, which is the one thing the whole
       * offered-not-applied convention exists to prevent.
       */
      style: base.style,
      /*
       * And the upkeep is the resolver's, for the stronger reason: it is not a preference at all
       * but the level `resolveConstraints` settled, which the palette, the badge and the scorer all
       * read. A model that moved it would make the card say one thing and the plan do another.
       */
      upkeep: base.upkeep,
      rationale: match.rationale.trim() === '' ? base.rationale : match.rationale,
    };

    if (match.rationale.trim() !== '') won.push('rationale');
    accepted[base.id] = won;

    /*
     * Parsed again at the end, because reconciliation *composes* fields from two sources and a
     * combination neither side would have produced alone can still break a bound — an accepted
     * shortlist filtered down to nothing being the obvious one.
     */
    const checked = DesignBriefSchema.safeParse(merged);
    if (!checked.success) {
      refused.push(`slot ${base.id}: the merged brief did not validate, so the default stands`);
      accepted[base.id] = [];
      return base;
    }
    return checked.data;
  });

  return { briefs, accepted, refused };
}

/* ---------------------------------------------------------------- the checks */

/**
 * A room is only a room if something is going in it.
 *
 * The composed three are the exception and always answerable: a lawn, the planting and the lighting
 * are drawn by passes that run over the whole plan, so their rooms exist whether or not a feature
 * was ticked for them. `transition`, `arrival` and `passage` are likewise structural — every garden
 * has a way through it and a front.
 */
const ALWAYS_AVAILABLE: FunctionalZoneType[] = [
  'lawn',
  'planting',
  'transition',
  'arrival',
  'passage',
];

function usableZone(
  zone: FunctionalZoneType,
  requested: Set<DesiredFeature>,
): FunctionalZoneType | null {
  if (ALWAYS_AVAILABLE.includes(zone)) return zone;

  const claimed = [...requested].some((feature) => FEATURE_LIBRARY[feature].zone === zone);
  return claimed ? zone : null;
}

function usableZones(
  zones: FunctionalZoneType[],
  requested: Set<DesiredFeature>,
): FunctionalZoneType[] | null {
  const kept = zones.filter((zone) => usableZone(zone, requested) !== null);
  /*
   * Null rather than an empty list: "none of these rooms exist" is not the same answer as "this
   * concept has no secondary rooms", and only the fallback knows which was meant.
   */
  return kept.length === 0 ? null : kept;
}

/**
 * Compositions the plot has not already refused.
 *
 * `suitability` returning zero is a refusal rather than a low mark — a formal axis on a plot with no
 * axis is the wrong plan, not a worse one — so a shortlist the model wrote is filtered by what the
 * site selector already said. A shortlist that empties falls back, because a brief with no
 * composition to try is a brief the candidate loop cannot act on at all.
 */
function viableArchetypes(
  shortlist: LayoutArchetypeId[],
  base: DesignBrief,
  analysis: SiteAnalysis,
  refused: string[],
): LayoutArchetypeId[] | null {
  const viable = new Set(
    rankArchetypes(analysis, base)
      .filter((fit) => fit.score > 0)
      .map((fit) => fit.archetype.id),
  );

  const kept = shortlist.filter((id) => viable.has(id));
  const dropped = shortlist.filter((id) => !viable.has(id));
  for (const id of dropped) {
    refused.push(`slot ${base.id}: ${id} was shortlisted but this plot cannot hold it`);
  }

  return kept.length === 0 ? null : kept;
}

/**
 * Only what the user actually ticked, and only as many essentials as a garden can have.
 *
 * A feature nobody asked for is the one hallucination that would reach the drawing: the zone planner
 * builds rooms from the priority list, so an invented hot tub becomes a real rectangle in a real
 * garden. Dropped silently per entry rather than refusing the list, so a good ranking of nine real
 * features is not lost to one invented tenth.
 */
function askedFor(
  priorities: DesignBrief['featurePriorities'],
  requested: Set<DesiredFeature>,
  slot: string,
  refused: string[],
): DesignBrief['featurePriorities'] | null {
  const kept: DesignBrief['featurePriorities'] = [];
  const seen = new Set<DesiredFeature>();
  let essentials = 0;

  for (const entry of priorities) {
    if (!requested.has(entry.feature)) {
      refused.push(`slot ${slot}: ${entry.feature} was ranked but never asked for`);
      continue;
    }
    if (seen.has(entry.feature)) continue;
    seen.add(entry.feature);

    if (entry.tier === 'essential' && essentials >= MAX_ESSENTIALS) {
      /* Demoted rather than dropped: they asked for it, so it stays in the plan's ranking. */
      kept.push({ ...entry, tier: 'preferred' });
      refused.push(
        `slot ${slot}: ${entry.feature} demoted — more than ${MAX_ESSENTIALS} essentials`,
      );
      continue;
    }
    if (entry.tier === 'essential') essentials += 1;
    kept.push(entry);
  }

  return kept.length === 0 ? null : kept;
}

/**
 * A concept may leave out something that was asked for; it may not leave out something that was not.
 *
 * An exclusion is shown to the user beside the feature they ticked, so an entry naming a feature
 * they never chose reads as the tool having invented a request and then turned it down.
 */
function excludable(
  excluded: DesignBrief['excludedFeatures'],
  requested: Set<DesiredFeature>,
  slot: string,
  refused: string[],
): DesignBrief['excludedFeatures'] | null {
  const kept = excluded.filter((entry) => {
    if (requested.has(entry.feature)) return true;
    refused.push(`slot ${slot}: ${entry.feature} was excluded but never asked for`);
    return false;
  });

  return kept.length === 0 ? null : kept;
}
