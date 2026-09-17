import { Injectable } from '@nestjs/common';
import type { DesignElement, DesignScore, PlanDocument } from '@garden-studio/schema';
import { archetypeFor } from './generation/archetypes.js';
import { resolveConstraints } from './generation/constraints.js';
import { analyseSite, readDesignFor, scoreConcept } from './generation/design/index.js';

/**
 * A designer's reading of a layout that already exists.
 *
 * Until now the design agent could only judge a plan it had just drawn: `scoreConcept` had exactly
 * one call site, at the end of generation, on elements the generator had produced moments earlier.
 * That is enough to choose between three concepts and useless for the question the editor actually
 * raises — *this* garden, as the user has it now, with everything they have moved since.
 *
 * **Side-effect free, and query-free.** It writes nothing, and the three functions it stands on
 * (`analyseSite`, `readDesignFor`, `scoreConcept`) are all pure — no PostGIS, no row, no clock. So
 * it can be asked mid-redesign about a layout that has never been saved, which is exactly when the
 * reviewer needs to ask it, and the whole of it is testable with nothing running.
 *
 * **It reads; it never writes.** Nothing here returns geometry or a correction. What to do about a
 * fault is the planner's business, through the ordinary intents — keeping the thing that judges and
 * the thing that changes the garden apart, for the same reason `generation/design/**` may not import
 * the feedback table it produces.
 */
@Injectable()
export class DesignReviewService {
  /**
   * @param elements the layout to judge, which may be unsaved and may be nothing like the stored one
   *
   * **Judged against the strategy the user actually chose**, and the document already knows which
   * that is: the chosen concept carries the brief slot it was designed to. There is deliberately no
   * request parameter for it — a client passing a slot could disagree with the plan it is editing.
   *
   * This used to be slot A unconditionally, because it made no difference: the three briefs really
   * do differ — slot A is `social`, B `open`, C `planted` — and scored across four fixtures all
   * three gave the same total to four decimal places, since no principle read the fields that vary.
   * That is what the brief-driven weighting closed, and the slot now decides what the plan is
   * measured against: a retreat is no longer marked down for entertaining badly.
   */
  review(document: PlanDocument, elements: DesignElement[]): DesignScore {
    const analysis = analyseSite(document);
    const slot = slotOf(document);

    /*
     * The constraints come from the same single resolver generation uses. Reading `brief.budget`
     * or `brief.maintenance` directly here would be the second source the whole of
     * `resolveConstraints` exists to prevent — a badge saying one thing while the palette does
     * another is the defect that put that rule in the file.
     */
    const constraints = resolveConstraints(
      document.brief,
      archetypeFor(slot, 0),
      analysis.scale.designedArea,
    );

    const { brief } = readDesignFor(document, constraints, slot);

    /*
     * `realised`, always. The structural tier exists for sketched candidates inside the generator's
     * own loop, where half the plan has not been drawn yet; anything the editor can show a person
     * is finished by definition, and marking it against a gentler standard would flatter it.
     */
    return scoreConcept(elements, analysis, brief, 'realised');
  }
}

/**
 * Which of the three strategies this plan is an edit of.
 *
 * Read off the concept the user chose rather than asked for, because a plan in the editor came from
 * one of the three cards and the document records which. A plan with nothing chosen — generated
 * before the slot was recorded, or edited from scratch — falls back to slot A, which is the
 * intent-led recommendation and the honest default for a garden nobody picked a reading of.
 */
function slotOf(document: PlanDocument): 0 | 1 | 2 {
  const chosen = document.concepts.chosenConceptId;
  if (!chosen) return 0;

  const concept = document.concepts.concepts.find((entry) => entry.id === chosen);
  switch (concept?.strategy?.briefId) {
    case 'B':
      return 1;
    case 'C':
      return 2;
    default:
      return 0;
  }
}
