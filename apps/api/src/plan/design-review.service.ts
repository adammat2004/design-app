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
   * **There is no "which concept was this" parameter, and that was measured rather than assumed.**
   * The obvious signature takes the slot the concept was designed to, so a retreat is not marked
   * down for entertaining badly. The three briefs really do differ — slot A is `social`, B `open`,
   * C `planted`, and the primary zone moves with them — but scored across four fixtures all three
   * give **the same total to four decimal places and the same issues**: no principle reads the
   * fields that vary by slot. Offering the parameter anyway would be a setting the design ignores,
   * which is the one thing this codebase keeps catching itself doing. Recorded in TODOS as a gap in
   * the scorer; when it closes, the parameter goes back.
   */
  review(document: PlanDocument, elements: DesignElement[]): DesignScore {
    const analysis = analyseSite(document);

    /*
     * The constraints come from the same single resolver generation uses. Reading `brief.budget`
     * or `brief.maintenance` directly here would be the second source the whole of
     * `resolveConstraints` exists to prevent — a badge saying one thing while the palette does
     * another is the defect that put that rule in the file.
     */
    const constraints = resolveConstraints(
      document.brief,
      archetypeFor(0, 0),
      analysis.scale.designedArea,
    );

    const { brief } = readDesignFor(document, constraints, 0);

    /*
     * `realised`, always. The structural tier exists for sketched candidates inside the generator's
     * own loop, where half the plan has not been drawn yet; anything the editor can show a person
     * is finished by definition, and marking it against a gentler standard would flatter it.
     */
    return scoreConcept(elements, analysis, brief, 'realised');
  }
}
