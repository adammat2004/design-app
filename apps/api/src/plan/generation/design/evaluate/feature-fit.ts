import { polygonArea, type DesignIssue, type DesiredFeature } from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../../knowledge/feature-library.js';
import { clamp01, meanOf, NOT_APPLICABLE, type PrincipleResult } from './result.js';
import type { DesignSubject } from './subject.js';

/**
 * Did the concept deliver what the brief actually wanted, and did it overfill the plot doing it?
 *
 * The gate rather than a weighted category, for a reason worth stating: a concept missing something
 * the brief called essential is not a slightly worse concept, it is the wrong concept. An
 * entertaining garden with nowhere to sit does not get to win on circulation. So a missed essential
 * caps the total rather than costing it a fraction.
 *
 * The other half is density, which is the failure the old `featureAttempts` budget existed to
 * prevent and could only approximate by counting. Counting is the wrong unit — six small things fit
 * where three large ones do not — so what is measured here is the share of the room the built
 * features cover. Past about two thirds a garden stops having any ground left to be a garden.
 */

/** Above this share of the room covered by built features, a plan is crowded. */
const DENSITY_LIMIT = 0.65;

/** And above this it is a yard with things in it. */
const DENSITY_BAD = 0.85;

export interface FeatureFit {
  result: PrincipleResult;
  /** The ceiling this puts on the concept's total, 1 when every essential landed. */
  cap: number;
}

export function scoreFeatureFit(subject: DesignSubject): FeatureFit {
  const issues: DesignIssue[] = [];
  const parts: number[] = [];

  const placed = new Set<DesiredFeature>();
  for (const item of subject.items) if (item.feature) placed.add(item.feature);
  /*
   * The composed three are answered by what the passes drew, not by a placed footprint: a lawn is
   * an accent panel, planting is a bed, lighting is a fitting. Read off the elements for the same
   * reason `build` does it that way — a courtyard with no room for a lawn has to be able to say so.
   */
  if (subject.panels.some((panel) => panel.category === 'lawn')) placed.add('lawn');
  if (subject.beds.length > 0) placed.add('plantingBeds');
  if (subject.elements.some((element) => element.category === 'lighting')) placed.add('lighting');

  const wanted = subject.brief.featurePriorities;
  const excluded = new Set(subject.brief.excludedFeatures.map((entry) => entry.feature));

  let cap = 1;
  if (wanted.length > 0) {
    let earned = 0;
    let available = 0;

    for (const entry of wanted) {
      /*
       * A feature the brief itself excluded is not a miss. Excluding it was a design decision, it
       * was reported with a reason, and scoring the concept down for honouring its own brief would
       * make "drop the pond to keep the lawn" always lose to "cram the pond in".
       */
      if (excluded.has(entry.feature)) continue;

      const weight = entry.tier === 'essential' ? 3 : entry.tier === 'preferred' ? 2 : 1;
      available += weight;
      if (placed.has(entry.feature)) {
        earned += weight;
        continue;
      }

      if (entry.tier === 'essential') {
        cap = Math.min(cap, 0.5);
        issues.push({
          code: 'missing-essential',
          principle: 'featureFit',
          severity: 'critical',
          message: `${label(entry.feature)} is essential to this concept and could not be placed.`,
          subjects: [],
          repair: 'drop-optional',
        });
      }
    }

    if (available > 0) parts.push(earned / available);
  }

  /* ---- density ---- */
  const room = subject.analysis.room;
  if (room) {
    const roomArea = Math.max(1, polygonArea(room));
    const covered = subject.items.reduce((total, item) => total + item.area, 0);
    const share = covered / roomArea;
    parts.push(
      share <= DENSITY_LIMIT
        ? 1
        : clamp01(1 - (share - DENSITY_LIMIT) / (DENSITY_BAD - DENSITY_LIMIT)),
    );

    if (share > DENSITY_BAD) {
      issues.push({
        code: 'feature-density',
        principle: 'featureFit',
        severity: 'major',
        message: `Built features cover ${Math.round(share * 100)}% of the garden, leaving nothing between them.`,
        subjects: [],
        repair: 'drop-optional',
      });
    }
  }

  return {
    result: parts.length > 0 ? { score: meanOf(parts), issues } : { ...NOT_APPLICABLE, issues },
    cap,
  };
}

function label(feature: DesiredFeature): string {
  const zone = FEATURE_LIBRARY[feature].zone;
  switch (feature) {
    case 'seating':
      return 'Somewhere to sit';
    case 'dining':
      return 'Somewhere to eat';
    case 'play':
      return 'A play area';
    case 'storage':
      return 'A garden store';
    case 'lawn':
      return 'A lawn';
    case 'plantingBeds':
      return 'Planting beds';
    default:
      return `The ${zone} area`;
  }
}
