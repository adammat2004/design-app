import {
  DESIRED_FEATURE_LABELS,
  formatArea,
  STYLE_LABELS,
  type DesignBrief,
  type GardenBrief,
} from '@garden-studio/schema';
import type { Requirements, SiteAnalysis } from '../../generation/design/types.js';

/**
 * What the model is told about the site and the brief.
 *
 * A rendered summary rather than the document, for the reason `garden-inventory.ts` gives: the
 * model's job is to rank and characterise, and handing it geometry would only invite it to reason
 * about space — which is the engine's job, and which it would do worse than the engine while being
 * impossible to check.
 *
 * **No coordinates reach this prompt.** Not the boundary's, not the house's, not a zone's. Areas,
 * a shape word and two room dimensions do — those are facts about how much garden there is, which
 * is exactly what ranking needs and what no amount of ticking cards can convey. The difference is
 * that none of them can be *acted* on positionally: "the garden is 9 m deep" cannot become a
 * placement, where "the house is at (12, 30)" invites one.
 *
 * **The deterministic answer is included on purpose.** The model is being asked to improve on a
 * brief that already exists rather than to invent one from nothing, which is what makes falling
 * back to it safe and what stops a thin answer being worse than no answer at all.
 */
export function renderDesignBriefInventory(
  brief: GardenBrief,
  analysis: SiteAnalysis,
  requirements: Requirements,
  fallback: DesignBrief[],
): string {
  const unit = 'm';
  const lines: string[] = [];

  /* ---- the plot ---- */

  lines.push('THE SITE');
  lines.push(`  Whole plot: ${formatArea(analysis.plotArea, unit)}.`);
  lines.push(`  Being redesigned: ${formatArea(analysis.scale.designedArea, unit)}.`);
  lines.push(`  Shape: ${analysis.shape}.`);

  if (analysis.roomDepth !== null && analysis.roomWidth !== null) {
    lines.push(
      `  The garden behind the house measures about ${analysis.roomDepth.toFixed(1)} m from the` +
        ` doors to the far fence and ${analysis.roomWidth.toFixed(1)} m across.`,
    );
  } else {
    lines.push('  No house is mapped, so there is no garden room to compose in.');
  }

  lines.push(
    analysis.exits.primary
      ? '  The garden doors are mapped, so a terrace across them is possible.'
      : '  No garden door is mapped.',
  );
  lines.push(
    analysis.sideGate
      ? '  There is a side gate, so bins and a mower can reach the garden without going through the house.'
      : '  There is no side gate; anything stored in the garden has to be carried through the house.',
  );

  /*
   * Stated rather than inferred, and absent when the document says nothing. The privacy strategy is
   * the field this feeds, and a model told "the neighbours overlook it" about a boundary nobody
   * described would be inventing the one fact that decision rests on.
   */
  const exposed = analysis.edges.filter((edge) => edge.exposure !== 'unknown');
  lines.push(
    exposed.length === 0
      ? '  Nothing is recorded about what is on the other side of any boundary.'
      : `  Boundaries described: ${exposed
          .map((edge) => `${edge.side ?? 'a side'} faces ${edge.exposure}`)
          .join(', ')}.`,
  );

  lines.push(
    analysis.sun
      ? '  The location is known, so where the shade falls can be worked out.'
      : '  No location is set, so nothing can be said about sun or shade.',
  );

  /* ---- what they asked for ---- */

  lines.push('', 'WHAT THEY ASKED FOR');
  lines.push(
    `  Spaces ticked: ${
      brief.desiredFeatures.length === 0
        ? '(none)'
        : brief.desiredFeatures.map((feature) => DESIRED_FEATURE_LABELS[feature]).join(', ')
    }.`,
  );
  lines.push(`  Style: ${brief.style ? STYLE_LABELS[brief.style] : '(not chosen)'}.`);
  lines.push(`  Budget: ${brief.budget}. Upkeep they will accept: ${brief.maintenance}.`);
  lines.push(
    brief.purpose && brief.purpose.trim() !== ''
      ? `  In their own words: "${brief.purpose.trim()}"`
      : '  They wrote nothing in their own words.',
  );

  /* ---- the deterministic answer ---- */

  lines.push('', 'THE ANSWER THIS SYSTEM GIVES WITHOUT YOU');
  lines.push(
    `  It reads the intent as "${requirements.intent}"` +
      (requirements.keywords.length > 0
        ? `, from the words: ${requirements.keywords.join(', ')}.`
        : ', from the ticked spaces alone.'),
  );
  lines.push(
    `  It judges this plot can carry about ${requirements.capacity} separate areas without crowding.`,
  );

  for (const entry of fallback) {
    lines.push(
      `  ${entry.id}: ${entry.emphasis}, organised around the ${entry.primaryZone}.` +
        ` Compositions tried: ${entry.archetypeShortlist.join(', ')}.`,
    );
    const essentials = entry.featurePriorities
      .filter((priority) => priority.tier === 'essential')
      .map((priority) => DESIRED_FEATURE_LABELS[priority.feature]);
    lines.push(
      `     Essential: ${essentials.length > 0 ? essentials.join(', ') : '(none)'}.` +
        (entry.excludedFeatures.length > 0
          ? ` Leaves out: ${entry.excludedFeatures
              .map((excluded) => DESIRED_FEATURE_LABELS[excluded.feature])
              .join(', ')}.`
          : ''),
    );
  }

  lines.push(
    '',
    'Return three briefs. Improve on the answer above where you can see a better one, and keep it',
    'where you cannot — it is a reasonable default, not a straw man.',
  );

  return lines.join('\n');
}
