import type {
  ConceptExplanation,
  DesignBrief,
  DesignScore,
  FunctionalZoneType,
} from '@garden-studio/schema';
import type { SlotKind } from '../layout/sketch.js';
import type { Decision } from './types.js';

/**
 * What a concept decided, recorded as it decides it.
 *
 * Until now the only prose a concept carried was one of three fixed sentences describing the
 * *template* — the same words whether the plan had a shed in the corner or no shed at all. This is
 * the replacement, and the rule that keeps it honest is that a decision is appended **by the pass
 * that takes it**, naming the elements it produced. The explanation therefore cannot claim the
 * terrace went at the doors unless a terrace element exists to point at.
 *
 * A small helper rather than a class: a `Decision[]` is just a list, and the value is in the
 * discipline of where they are added, not in the machinery for adding them.
 */

export function decide(kind: string, text: string, subjects: string[] = []): Decision {
  return { kind, text, subjects: subjects.slice(0, 8) };
}

/**
 * The explanation a concept carries, assembled from what it decided and what it left out.
 *
 * The repairs are quoted as sentences rather than as codes because they are the most interesting
 * line on the card: "narrowed the terrace to keep a usable lawn" is a designer's sentence, and it
 * is true precisely because the scorer measured the lawn before and after.
 */
export function buildExplanation(
  brief: DesignBrief,
  archetype: ConceptExplanation['strategy'],
  decisions: Decision[],
  repairs: string[] = [],
): ConceptExplanation {
  return {
    strategy: archetype,
    briefId: brief.id,
    intent: brief.intent,
    emphasis: brief.emphasis,
    rationale: brief.rationale,
    decisions: decisions.slice(0, 24),
    excludedFeatures: brief.excludedFeatures,
    repairs: repairs.slice(0, 8),
  };
}

/**
 * The faults worth showing a user, as sentences.
 *
 * Not every issue: a plan with eleven minor observations on it reads as broken when it is merely
 * imperfect, and the honest thing to surface is what a designer would mention unprompted. Major and
 * critical only, and at most three.
 */
export function notableIssues(score: DesignScore): string[] {
  return score.issues
    .filter((issue) => issue.severity !== 'minor')
    .slice(0, 3)
    .map((issue) => issue.message);
}

/* ---------------------------------------------------------------- the words */

/**
 * What each room is called in a sentence.
 *
 * Separate from `FunctionalZoneType` because the enum is a key and this is English: "the utility
 * corner" and "the working end of the garden" are the same zone, and the id should not have to
 * choose between being readable and being stable.
 */
const ZONE_WORDS: Record<FunctionalZoneType, string> = {
  terrace: 'terrace',
  dining: 'dining area',
  lounge: 'second sitting area',
  play: 'play area',
  lawn: 'open lawn',
  utility: 'utility corner',
  productive: 'working end of the garden',
  planting: 'planting',
  water: 'water feature',
  destination: 'far corner of the garden',
  transition: 'circulation',
  arrival: 'front garden',
  passage: 'side return',
};

export function zoneWords(zone: FunctionalZoneType): string {
  return ZONE_WORDS[zone];
}

/**
 * Where a slot puts a thing, said as a person would say it.
 *
 * The half of a decision that makes it worth reading: "the garden store in the utility corner" is a
 * category, "on the gate's side where the bins can reach it" is a reason. Written from the slot
 * because the slot is what actually decided, so the sentence cannot claim a placement the fitter
 * did not make.
 */
export function placementWords(slot: SlotKind, hasGate: boolean): string {
  switch (slot) {
    case 'terrace':
      return 'across the doors';
    case 'beside-terrace':
      return 'against the house wall, out of the way of the route onto the grass';
    case 'terrace-end':
      return 'at the end of the terrace, so each room has its own floor';
    case 'terrace-corner':
      return 'in the corner of the terrace, within reach of the door';
    case 'far-room':
      return 'at the far end, on the diagonal from the doors';
    case 'lawn-far':
      return 'at the far end of the lawn, where it can be seen from the house';
    case 'utility':
      return hasGate
        ? "on the gate's side, where the bins and the mower can reach it without crossing the lawn"
        : 'in the corner furthest from the view out of the doors';
    case 'utility-2':
      return 'beside the other working areas';
    case 'axis-end':
      return 'at the end of the axis, terminating the view from the doors';
  }
}

/** A fragment turned into the start of a sentence. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "The play area in the play area" — said once, not twice.
 *
 * A feature's plan name and its room's name are the same words often enough to matter: a play area
 * *is* the play area, a water feature is the water. Where they collide the room is dropped, because
 * the placement is the half of the sentence carrying information.
 */
export function placedSentence(
  planName: string,
  zone: FunctionalZoneType,
  slot: SlotKind,
  hasGate: boolean,
): string {
  const room = zoneWords(zone);
  const repeats = planName.toLowerCase().includes(room.toLowerCase());
  const where = placementWords(slot, hasGate);
  return repeats
    ? `${sentence(planName)} ${where}.`
    : `${sentence(planName)} in the ${room}, ${where}.`;
}
