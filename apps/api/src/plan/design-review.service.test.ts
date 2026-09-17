import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPlanDocument, type DesignElement, type PlanDocument } from '@garden-studio/schema';
import { archetypeFor } from './generation/archetypes.js';
import { resolveConstraints } from './generation/constraints.js';
import { analyseSite, readDesignFor, scoreConcept } from './generation/design/index.js';
import { DesignReviewService } from './design-review.service.js';

/**
 * No database, no generator, no model.
 *
 * Everything the reviewer stands on is pure, which is the property that lets it be asked about an
 * unsaved layout in the middle of a redesign — so the test needs nothing running either. That is
 * not a coincidence to note in passing; it is what the endpoint is for.
 */
const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): PlanDocument {
  return readPlanDocument(
    JSON.parse(
      readFileSync(resolve(here, `../../../web/scripts/fixtures/${name}.plan.json`), 'utf8'),
    ),
  );
}

const reviewer = new DesignReviewService();

describe('DesignReviewService', () => {
  it('scores a stored layout on the nine principles', () => {
    const document = fixture('entertaining');
    const score = reviewer.review(document, document.layout.elements);

    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(1);
    expect(score.tier).toBe('realised');
    expect(Object.keys(score.categories).length).toBeGreaterThan(5);
  });

  it('names real elements in what it complains about', () => {
    /*
     * The whole value of the reviewer to a redesign is that its faults point at something: an issue
     * naming an element the plan does not contain cannot be turned into a correction.
     */
    const document = fixture('entertaining');
    const ids = new Set(document.layout.elements.map((element) => element.id));
    const score = reviewer.review(document, document.layout.elements);

    const named = score.issues
      .flatMap((issue) => issue.subjects)
      .filter((subject) => ids.has(subject));
    expect(score.issues.length).toBeGreaterThan(0);
    expect(named.length).toBeGreaterThan(0);
  });

  it('writes nothing to the document it was handed', () => {
    const document = fixture('entertaining');
    const before = JSON.stringify(document);

    reviewer.review(document, document.layout.elements);

    expect(JSON.stringify(document)).toBe(before);
  });

  it('is deterministic', () => {
    const document = fixture('entertaining');
    const once = reviewer.review(document, document.layout.elements);
    const twice = reviewer.review(document, document.layout.elements);

    expect(twice).toEqual(once);
  });

  it('judges the elements it is given, not the ones the plan has stored', () => {
    // The point of the endpoint: a layout part-way through a redesign has been saved nowhere.
    const document = fixture('entertaining');
    const stripped = document.layout.elements.filter(
      (element) => element.category !== 'planting-bed',
    );

    const whole = reviewer.review(document, document.layout.elements);
    const bare = reviewer.review(document, stripped);

    expect(bare.total).not.toBe(whole.total);
  });

  it('marks a garden with nothing in it as badly as it deserves', () => {
    const document = fixture('entertaining');
    const empty: DesignElement[] = [];

    const score = reviewer.review(document, empty);

    // Missing what the brief called essential caps the total rather than merely reducing it.
    expect(score.total).toBeLessThanOrEqual(0.5);
  });

  it('gives a different answer for the three strategies', () => {
    /*
     * This test used to assert the opposite, and pinned a limitation rather than a feature so that
     * it would fail the day it stopped being true. It has.
     *
     * The three briefs always differed — A is `social`, B `open`, C `planted`, and the primary zone
     * moves with them — and no principle read the fields that varied, so every slot returned the
     * same total on every fixture. Now the weights follow the brief and four principles read it, so
     * a retreat is no longer marked against the standard an entertaining garden is held to.
     */
    const document = fixture('entertaining');
    const analysis = analyseSite(document);
    const constraints = (slot: 0 | 1 | 2) =>
      resolveConstraints(document.brief, archetypeFor(slot, 0), analysis.scale.designedArea);

    const totals = ([0, 1, 2] as const).map((slot) => {
      const { brief } = readDesignFor(document, constraints(slot), slot);
      return scoreConcept(document.layout.elements, analysis, brief, 'realised').total;
    });

    expect(new Set(totals).size).toBeGreaterThan(1);
  });

  it('judges the plan against the strategy the user actually chose', () => {
    /*
     * The slot is not a request parameter: the document already records which of the three cards
     * was taken, and a client passing one could disagree with the plan it is editing.
     */
    const document = fixture('entertaining');
    const concept = document.concepts.concepts[0];
    if (!concept?.strategy) return;

    const analysis = analyseSite(document);
    const slotOf = { A: 0, B: 1, C: 2 } as const;
    const slot = slotOf[concept.strategy.briefId];

    const chosen: PlanDocument = {
      ...document,
      concepts: { ...document.concepts, chosenConceptId: concept.id },
    };

    const { brief } = readDesignFor(
      document,
      resolveConstraints(document.brief, archetypeFor(slot, 0), analysis.scale.designedArea),
      slot,
    );

    expect(reviewer.review(chosen, document.layout.elements).total).toBe(
      scoreConcept(document.layout.elements, analysis, brief, 'realised').total,
    );
  });

  it('falls back to the recommendation when no concept was chosen', () => {
    const document = fixture('entertaining');
    const analysis = analyseSite(document);
    const { brief } = readDesignFor(
      document,
      resolveConstraints(document.brief, archetypeFor(0, 0), analysis.scale.designedArea),
      0,
    );

    expect(reviewer.review(document, document.layout.elements).total).toBe(
      scoreConcept(document.layout.elements, analysis, brief, 'realised').total,
    );
  });
});
