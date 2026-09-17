import {
  geometryIsLegal,
  issuesBySeverity,
  performableInEditor,
  REPAIR_CAPABILITIES,
  REPAIR_KINDS,
  type DesignElement,
  type DesignIssue,
  type PlanDocument,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DesignRepairService } from './design-repair.service.js';
import { DesignReviewService } from './design-review.service.js';
import { PlannerService } from './assistant/planner.service.js';
import { GALLERY_SITE, gallery } from './generation/design/evaluate/gallery.js';
import { FillService } from './generation/fill.service.js';
import { PlacementService } from './generation/placement.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../test/db.js';

const connection = await connectTestDatabase();

/**
 * The reviewer choosing a correction by measuring several, rather than taking the first legal one.
 *
 * Tested against the gallery's deliberately badly-composed gardens, because they are the only
 * fixtures in the project whose faults were *put there on purpose* — a generated plan scores 0.85
 * to 0.90 and its remaining faults are the two the design agent already records as out of reach, so
 * a repair test built on one would mostly be measuring how little there was to do.
 *
 * Real PostGIS, because every candidate goes through the same planner a user's sentence does, and
 * that planner places things with the real placer. No model anywhere: a fault is data, and what to
 * do about it is arithmetic.
 */

function documentFor(key: string): { document: PlanDocument; elements: DesignElement[] } {
  const garden = gallery(key);
  const elements = garden.elements;

  return {
    document: {
      ...GALLERY_SITE,
      brief: garden.brief,
      layout: { ...GALLERY_SITE.layout, elements },
    },
    elements,
  };
}

/** The worst fault of a gallery garden that the editor can actually act on. */
function faultIn(key: string, code?: DesignIssue['code']): { issue: DesignIssue } {
  const { document, elements } = documentFor(key);
  const score = new DesignReviewService().review(document, elements);

  const issue = issuesBySeverity(score).find(
    (found) =>
      performableInEditor(found.repair) &&
      found.subjects.some((subject) => elements.some((element) => element.id === subject)) &&
      (code === undefined || found.code === code),
  );

  if (!issue) throw new Error(`No repairable ${code ?? 'fault'} in ${key}`);
  return { issue };
}

describe.skipIf(connection === null)('DesignRepairService', () => {
  let repairer: DesignRepairService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    repairer = new DesignRepairService(
      new PlannerService(new PlacementService(db.db), new FillService(db.db)),
      new DesignReviewService(),
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('answers a fault with a change that measurably improves the plan', async () => {
    /*
     * The barbecue nine metres from the table, which is a fault with a destination — the guidance
     * names the dining area — and therefore one the move search can actually answer. Asserted on a
     * named fault rather than "the worst one", because the worst one is sometimes a fault nothing
     * can act on, and a test that accepts a refusal proves only that the code ran.
     */
    const { document, elements } = documentFor('entertaining-poor');
    const { issue } = faultIn('entertaining-poor', 'bbq-far-from-dining');

    const result = await repairer.repair(document, issue, elements);

    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.considered).toBeGreaterThan(1);
    expect(result.predicted).not.toBeNull();
    expect(result.predicted!.after).toBeGreaterThan(result.predicted!.before);
  });

  it('measures several corrections rather than taking the first legal one', async () => {
    const { document, elements } = documentFor('planted-poor');
    const { issue } = faultIn('planted-poor', 'view-blocked');

    const result = await repairer.repair(document, issue, elements);

    /* Several were legal and scored; the one that came back is the one that measured best. */
    expect(result.considered).toBeGreaterThan(1);
    expect(result.predicted!.resolved).toBe(true);
  });

  it('refuses rather than pretending, when nothing it tries helps', async () => {
    /*
     * The store in the sightline of the scattered garden. Four legal places to put it, none of which
     * makes the plan better — so the honest answer is nothing, with a count of how hard it looked.
     * Before this existed the loop would have played one of them and wound it back afterwards.
     */
    const { document, elements } = documentFor('scattered');
    const { issue } = faultIn('scattered', 'shed-in-view');

    const result = await repairer.repair(document, issue, elements);

    expect(result.changes).toEqual([]);
    expect(result.considered).toBeGreaterThan(0);
    expect(result.reason).toContain('makes the design better');
  });

  it('says what is missing when a fault wants a path laid rather than redrawn', async () => {
    /*
     * `route-missing` is the third commonest fault in the whole harness and its subject is the thing
     * nobody can reach rather than a path — so the correction is to *lay* a route, which is the one
     * repair verb with no planner behind it. Stating the limitation is the difference between a gap
     * somebody can close and a sentence that sounds like the plot's fault.
     */
    const { document, elements } = documentFor('family-poor');
    const { issue } = faultIn('family-poor', 'route-missing');

    const result = await repairer.repair(document, issue, elements);

    expect(result.changes).toEqual([]);
    expect(result.reason).toContain('laying a new path');
  });

  it('predicts what the plan will actually score', async () => {
    /*
     * The prediction is what lets the loop skip playing a change nothing could improve, so it has to
     * be the real number rather than an estimate: the client re-scores after playing it, and the two
     * disagreeing would be the reviewer marking its own homework.
     */
    const { document, elements } = documentFor('planted-poor');
    const { issue } = faultIn('planted-poor');

    const result = await repairer.repair(document, issue, elements);
    if (result.changes.length === 0) return;

    const after = applied(elements, result);
    const scored = new DesignReviewService().review(document, after);

    expect(scored.total).toBeCloseTo(result.predicted!.after, 9);
  });

  it('never proposes geometry the editor would refuse', async () => {
    const { document, elements } = documentFor('family-poor');
    const { issue } = faultIn('family-poor');

    const result = await repairer.repair(document, issue, elements);
    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));

    for (const change of result.changes) {
      expect(geometryIsLegal(change.next.shape, boundary)).toBe(true);
    }
  });

  it('gives the same answer twice', async () => {
    const { document, elements } = documentFor('entertaining-poor');
    const { issue } = faultIn('entertaining-poor');

    const once = await repairer.repair(document, issue, elements);
    const twice = await repairer.repair(document, issue, elements);

    expect(twice).toEqual(once);
  });

  it('says why rather than forcing a fault it cannot act on', async () => {
    const { document, elements } = documentFor('planted-poor');
    const impossible: DesignIssue = {
      code: 'bed-islands',
      principle: 'style',
      severity: 'minor',
      message: 'Three planting beds float free of the boundary and of each other.',
      subjects: elements.slice(0, 3).map((element) => element.id),
      repair: 'merge-beds',
      source: 'geometry',
    };

    const result = await repairer.repair(document, impossible, elements);

    expect(result.changes).toEqual([]);
    expect(result.considered).toBe(0);
    expect(result.reason).toContain('composition');
  });

  it('says so when a fault names nothing on the plan', async () => {
    const { document, elements } = documentFor('planted-poor');
    const nowhere: DesignIssue = {
      code: 'no-focal',
      principle: 'hierarchy',
      severity: 'minor',
      message: 'Nothing terminates the view down the garden from the doors.',
      subjects: [],
      repair: 'move-destination',
      source: 'geometry',
    };

    const result = await repairer.repair(document, nowhere, elements);

    expect(result.changes).toEqual([]);
    expect(result.reason).toContain('not about anything');
  });

  it('has an answer for every kind of repair the scorer can name', () => {
    /*
     * The table that replaced three. A repair kind with no row is one that is performable or not by
     * accident of whether somebody remembered a branch, which is exactly how the editor came to be
     * unable to do seven of the ten.
     */
    for (const kind of REPAIR_KINDS) {
      const capability = REPAIR_CAPABILITIES[kind];
      expect(capability, kind).toBeDefined();
      expect(capability.editor.length, kind).toBeGreaterThan(0);
      expect(capability.generator.length, kind).toBeGreaterThan(0);
      if (capability.verb === null) {
        expect(capability.editor, kind).not.toBe('performable');
        expect(capability.generator, kind).not.toBe('performable');
      }
    }
  });
});

if (connection === null) {
  describe('DesignRepairService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}

/** The plan as the result would leave it. */
function applied(
  elements: DesignElement[],
  result: { changes: { kind: string; elementId: string | null; next: DesignElement }[] },
): DesignElement[] {
  let next = elements;
  for (const change of result.changes) {
    if (change.kind === 'remove') {
      next = next.filter((element) => element.id !== change.elementId);
      continue;
    }
    if (change.kind === 'add') {
      next = [...next, change.next];
      continue;
    }
    next = next.map((element) => (element.id === change.elementId ? change.next : element));
  }
  return next;
}
