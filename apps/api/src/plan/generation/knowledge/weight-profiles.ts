import type { BriefEmphasis, GardenIntent, PrincipleId } from '@garden-studio/schema';
import { CONDITIONAL, PRINCIPLE_WEIGHTS, PRINCIPLES } from './principles.js';

/**
 * What this garden is judged on, given what it is for.
 *
 * `principles.ts` is a claim about landscape design in general and it was the whole of the scorer's
 * opinion: every concept, on every plot, for every client, was marked against one table. That is a
 * real defect rather than a simplification — **there is no universal definition of the perfect
 * garden**, and a scorer that behaves as though there is cannot tell the three concepts it offers
 * apart. Measured before this existed: four completely different briefs gave every garden in the
 * gallery the same answer to within 0.016.
 *
 * So the base weights are *shifted* by the brief and renormalised. An entertaining garden weighs how
 * its spaces relate and whether you can sit in them; a planted one weighs privacy, proportion and
 * the coherence of its massing; a low-upkeep one weighs what it will cost to look after. None of
 * these is the model's to choose — the shift is a table, read off `intent` and `emphasis`, which are
 * themselves derived from what the user ticked.
 *
 * Three properties worth keeping:
 *
 * - **A shift is a multiplier, never a replacement.** Every principle still counts for something in
 *   every garden: a shed in the sightline is a fault on an entertaining plan too. The range is
 *   deliberately narrow — 0.7 to 1.6 — because these are emphases rather than different scorers.
 * - **The result is renormalised**, so the eight that always apply still sum to one and the two
 *   conditional ones still sit on top at their base share. Two gardens judged by different profiles
 *   are still measured on the same scale.
 * - **Nothing here has authority over geometry.** Change every number and the same set of legal
 *   plans is produced; only which one is offered first, and which fault is repaired first, changes.
 */

export interface WeightProfile {
  /** Renormalised, over every principle. Attached to the score so the total can be explained. */
  weights: Record<PrincipleId, number>;
  /** What the shift was for, in one phrase. Quoted by the report and the explanation. */
  reason: string;
}

type Shift = Partial<Record<PrincipleId, number>>;

/**
 * Which way each emphasis leans.
 *
 * The emphasis is what makes the three concept slots three different readings of one brief — slot A
 * of an entertaining brief is `social`, B is `open`, C is `planted` — and until now nothing read it.
 * These are the numbers that make the three cards judged as the three different gardens they are.
 */
const EMPHASIS_SHIFT: Record<BriefEmphasis, Shift> = {
  /*
   * Eating outside with people: how the spaces relate, whether you are overlooked, one main room.
   *
   * Proportion is *not* discounted here, for the reason circulation is not discounted under
   * `planted`: what a social garden wants differently is the share of hard landscaping, which
   * `emphasis-bands.ts` already asks for. Weighted down as well it counted twice, and the
   * measurement was immediate — on a deep plot the social slot abandoned the composition it had
   * been taking and landed on the one the planted slot had already taken, so two of the three
   * cards came back with the same drawing.
   */
  social: { relationships: 1.4, privacy: 1.2, hierarchy: 1.2, sun: 1.2 },
  /* One generous open panel: proportion is the whole of it, and the spaces round it matter less. */
  open: { proportion: 1.4, hierarchy: 1.2, grouping: 0.9, relationships: 0.8 },
  /*
   * Deep planting and somewhere quiet in it: enclosure and massing.
   *
   * Note what is *not* here. Discounting circulation was the obvious move and it is wrong twice
   * over: a planted garden still has to be walkable, and the thing that reading was reaching for —
   * a route that wanders rather than arrives — is already granted by `brief.circulation`, which
   * widens the detour tolerance for exactly these concepts. Weighted down here as well it counted
   * twice, and the measurement showed what that buys: on a deep plot the composition whose routes
   * are longest came out top of two of the three slots, and the same layout was offered on two
   * cards.
   */
  planted: { privacy: 1.3, style: 1.3, proportion: 1.2 },
  /* A working garden: you carry things about it, and the beds have to be reachable and buildable. */
  productive: { circulation: 1.3, buildability: 1.4, relationships: 1.2, hierarchy: 0.7 },
};

/**
 * Which way the garden's whole purpose leans, on top of the slot's emphasis.
 *
 * Intent is the same for all three slots, so this is what separates one *brief* from another rather
 * than one card from its neighbours. `mixed` is absent on purpose: a garden that is equally four
 * things is judged by the general table, which is what `mixed` means.
 */
const INTENT_SHIFT: Partial<Record<GardenIntent, Shift>> = {
  entertaining: { relationships: 1.2, sun: 1.2 },
  family: { relationships: 1.3 },
  relaxation: { privacy: 1.4, sun: 1.3 },
  gardening: { buildability: 1.3, circulation: 1.2 },
  /* The one intent that is mostly about what the garden costs to keep rather than how it is composed. */
  lowMaintenance: { maintenanceFit: 1.6, style: 1.2, buildability: 1.2, proportion: 1.1 },
  showcase: { hierarchy: 1.4, style: 1.4 },
};

/** How each emphasis reads in the one phrase the report prints. */
const EMPHASIS_REASON: Record<BriefEmphasis, string> = {
  social: 'judged as a garden for eating outside with people in it',
  open: 'judged as a garden built round one generous open panel',
  planted: 'judged as a planted garden to sit quietly in',
  productive: 'judged as a working garden',
};

export function weightProfile(brief: {
  intent: GardenIntent;
  emphasis: BriefEmphasis;
}): WeightProfile {
  const shifted: Record<PrincipleId, number> = {} as Record<PrincipleId, number>;

  for (const principle of PRINCIPLES) {
    const emphasis = EMPHASIS_SHIFT[brief.emphasis][principle.id] ?? 1;
    const intent = INTENT_SHIFT[brief.intent]?.[principle.id] ?? 1;
    shifted[principle.id] = principle.weight * emphasis * intent;
  }

  /*
   * Renormalised in two groups rather than one.
   *
   * The eight that always apply are scaled to sum to one, exactly as the base table does. Each
   * conditional principle is scaled on its own to keep its base share — otherwise raising
   * `maintenanceFit` by 1.6 would quietly take weight off the other nine rather than saying that
   * upkeep matters more to this client than it does in general.
   */
  const always = PRINCIPLES.filter((principle) => !CONDITIONAL.includes(principle.id));
  const total = always.reduce((sum, principle) => sum + shifted[principle.id], 0);

  const weights: Record<PrincipleId, number> = {} as Record<PrincipleId, number>;
  for (const principle of always) weights[principle.id] = shifted[principle.id] / total;
  for (const id of CONDITIONAL) weights[id] = shifted[id];

  return { weights, reason: reasonFor(brief) };
}

function reasonFor(brief: { intent: GardenIntent; emphasis: BriefEmphasis }): string {
  const emphasis = EMPHASIS_REASON[brief.emphasis];
  return brief.intent === 'lowMaintenance'
    ? `${emphasis}, and one that has to look after itself`
    : emphasis;
}

/** The unshifted table, for a caller that has no brief to read. Same shape, same scale. */
export const BASE_PROFILE: WeightProfile = {
  weights: PRINCIPLE_WEIGHTS as Record<PrincipleId, number>,
  reason: 'judged against the general table',
};
