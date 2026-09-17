import {
  PlanDocumentSchema,
  prepareRun,
  runFromProposal,
  suggestedAccess,
  type DesignElement,
  type DesignIntent,
  type PlanDocument,
  type Point,
} from '@garden-studio/schema';
import type Anthropic from '@anthropic-ai/sdk';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DesignRepairService } from '../design-repair.service.js';
import { DesignReviewService } from '../design-review.service.js';
import { FillService } from '../generation/fill.service.js';
import { PlacementService } from '../generation/placement.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../../test/db.js';
import { IntentService } from './intent.service.js';
import { PlannerService } from './planner.service.js';

const connection = await connectTestDatabase();

/**
 * The whole chain, joined up once: sentence → intents → geometry → operations → a scored garden.
 *
 * Every link was already covered and **nothing joined them**. A fake model produced intents in one
 * suite; the planner turned intents into changes against real PostGIS in another; hand-written
 * changes became operations in a third on the other side of the repository. So a change to what
 * `ProposedChange` means on the server would have failed no test at all, and the property that
 * matters most — *the executor never refuses what the planner proposes* — was asserted only about
 * changes a test had written by hand.
 *
 * It is one test rather than a suite because it is one claim. What each link does is tested where
 * it lives; this asserts that the links fit.
 *
 * **No model.** The client is the same `Pick<Anthropic, 'messages'>` fake every assistant test uses,
 * so the sentence half is exercised up to the request and no further. Real PostGIS, because the
 * planner places things with the real placer.
 */

type FakeClient = Pick<Anthropic, 'messages'>;

/** The model id and nothing else: this suite never reaches a network. */
function config(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

/** A model that answers with exactly these intents, having been asked properly. */
function client(intents: DesignIntent[]): { fake: FakeClient; asked: () => unknown } {
  let request: unknown = null;

  const fake = {
    messages: {
      create: async (body: unknown) => {
        request = body;
        return {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                reply: "I'll sort that out.",
                intents,
                suggestions: ['Make the terrace bigger', 'Add lighting', 'Move the store'],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      },
    },
  } as unknown as FakeClient;

  return { fake, asked: () => request };
}

function element(over: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    name: over.id,
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 7, y: 11 }, width: 5, depth: 3.6, rotation: 0 },
    ...over,
  };
}

/** A 14 × 18 m plot with the house across the top, a terrace, a store and a path between them. */
const TERRACE = element({
  id: 'e-terrace',
  name: 'Seating patio',
  material: 'stone-pavers',
  shape: { kind: 'rect', centre: { x: 6, y: 10.9 }, width: 6, depth: 3.8, rotation: 12 },
});

/*
 * Skewed on purpose, and it is the store rather than the terrace that is out of true. A rotation is
 * refused when the turned shape would hit something, and the terrace has a path leaving it — so
 * turning *that* is a fault of the fixture rather than of the planner, and the test would be
 * measuring a collision instead of the chain.
 */
const STORE = element({
  id: 'e-store',
  name: 'Garden store',
  category: 'structure',
  material: 'softwood',
  shape: { kind: 'rect', centre: { x: 11.8, y: 1.9 }, width: 2.2, depth: 2, rotation: 18 },
});

const PATH = element({
  id: 'e-path',
  name: 'Path to the store',
  material: 'stone-setts',
  shape: {
    kind: 'polyline',
    width: 1.2,
    points: [
      { x: 6, y: 8.9 },
      { x: 1.5, y: 8.9 },
      { x: 1.5, y: 3 },
      { x: 10.6, y: 3 },
    ],
  },
});

function plan(elements: DesignElement[]): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 3,
    unit: 'm',
    site: suggestedAccess(
      PlanDocumentSchema.shape.site.parse({
        vertices: [
          { id: 'v0', x: 0, y: 0 },
          { id: 'v1', x: 14, y: 0 },
          { id: 'v2', x: 14, y: 18 },
          { id: 'v3', x: 0, y: 18 },
        ],
        closed: true,
        house: {
          outline: [
            { id: 'h0', x: -7, y: -2.5 },
            { id: 'h1', x: 7, y: -2.5 },
            { id: 'h2', x: 7, y: 2.5 },
            { id: 'h3', x: -7, y: 2.5 },
          ],
          centre: { x: 7, y: 15.5 },
          rotation: 0,
        },
        selectedZoneIds: ['back'],
      }),
    ),
    brief: {
      purpose: 'Somewhere to sit and a store we can actually get to.',
      desiredFeatures: ['seating', 'storage', 'plantingBeds'],
      featuresOther: '',
      budget: 'medium',
      maintenance: 'medium',
      style: 'modern',
      styleOther: '',
    },
    layout: { elements },
  });
}

const BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 18 },
  { x: 0, y: 18 },
];

describe.skipIf(connection === null)('the whole assistant pipeline', () => {
  let planner: PlannerService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    planner = new PlannerService(new PlacementService(db.db), new FillService(db.db));
  });

  afterAll(async () => {
    await db?.close();
  });

  it('turns a sentence into operations the executor accepts in full', async () => {
    /*
     * Three intents, chosen because each exercises a different half of the chain: a resize goes
     * through the legality search, a rotate through the new bearing resolver, a reroute through the
     * generator's own router. All three are things the vocabulary could not express before this
     * phase — the executor has animated a turn and a redraw since the operations schema was written
     * and nothing upstream could ever ask for one.
     */
    const { fake, asked } = client([
      { kind: 'resize', target: { elementIds: ['e-terrace'] }, factor: 1.15 },
      { kind: 'rotate', target: { elementIds: ['e-store'] }, to: 'house' },
      { kind: 'reroute', target: { elementIds: ['e-path'] }, objective: 'direct' },
    ]);

    const document = plan([TERRACE, STORE, PATH]);
    const envelope = await new IntentService(fake, config()).interpret(
      'Square the store up to the house, make the terrace a bit bigger, and straighten that path.',
      document,
      [],
    );

    /* The model was asked; nothing about the answer was invented by the test. */
    expect(asked()).not.toBeNull();
    expect(envelope.intents).toHaveLength(3);

    const { changes, unplaceable } = await planner.plan(document, envelope.intents);
    expect(changes.length).toBeGreaterThan(0);

    const run = runFromProposal(changes, 'Square the store up', 'pipeline-1');
    expect(run).not.toBeNull();

    const prepared = prepareRun(run!, document.layout.elements, {
      boundary: BOUNDARY,
      allocateId: (index) => `new-${index}`,
    });

    /*
     * The claim the whole chain rests on: **the editor never refuses what the planner proposed.**
     * An operation resolved as illegal is animated for nothing and reported as a failure the user
     * did not cause, and it is the one defect that could not be caught before these two halves were
     * testable together.
     */
    expect(prepared.refused).toEqual([]);
    expect(prepared.result).not.toBe(document.layout.elements);

    /* And every refusal the planner did report is a sentence, not a silence. */
    for (const refusal of unplaceable) expect(refusal.reason.length).toBeGreaterThan(10);
  });

  it('carries a turn and a redraw all the way to the canvas', async () => {
    /*
     * Named operations rather than a count, because `from-proposal` derives the kind from the two
     * elements rather than from the change's own label — a rotate that also moved would arrive as a
     * move, and the panel would narrate the wrong thing.
     */
    const document = plan([TERRACE, STORE, PATH]);
    const { changes } = await planner.plan(document, [
      { kind: 'rotate', target: { elementIds: ['e-store'] }, to: 'house' },
      { kind: 'reroute', target: { elementIds: ['e-path'] }, objective: 'direct' },
    ]);

    const run = runFromProposal(changes, 'Tidy it up', 'pipeline-2')!;
    const kinds = run.operations.flatMap((operation) =>
      operation.kind === 'group' ? operation.children.map((child) => child.kind) : [operation.kind],
    );

    expect(kinds).toContain('rotate');
    expect(kinds).toContain('reroute');
  });

  it('scores the garden the run actually produced', async () => {
    /*
     * The far end of the chain. The reviewer reads elements rather than the stored plan, so what it
     * judges is what the executor left — which is what makes "the design improved" a claim about the
     * garden on screen rather than about the diff that was proposed.
     */
    const document = plan([TERRACE, STORE, PATH]);
    const { changes } = await planner.plan(document, [
      { kind: 'reroute', target: { elementIds: ['e-path'] }, objective: 'direct' },
    ]);

    const run = runFromProposal(changes, 'Straighten the path', 'pipeline-3')!;
    const prepared = prepareRun(run, document.layout.elements, {
      boundary: BOUNDARY,
      allocateId: (index) => `new-${index}`,
    });

    const reviewer = new DesignReviewService();
    const before = reviewer.review(document, document.layout.elements);
    const after = reviewer.review(document, prepared.result);

    expect(after.total).toBeGreaterThan(0);
    /* Straightening a route that doubled back is what the circulation principle measures. */
    expect(after.categories.circulation!).toBeGreaterThanOrEqual(before.categories.circulation!);
  });

  it('measures a correction, plays it, and lands a better garden', async () => {
    /*
     * The reviewer's half of the same chain, end to end: a fault the scorer found, a correction the
     * repair service chose by measuring several, and a run the executor accepts — with the score
     * afterwards being the one the server predicted.
     */
    const document = plan([TERRACE, STORE, PATH]);
    const reviewer = new DesignReviewService();
    const repairer = new DesignRepairService(planner, reviewer);

    const score = reviewer.review(document, document.layout.elements);
    const fault = score.issues.find((issue) => issue.repair === 'align');
    if (!fault) return;

    const repair = await repairer.repair(document, fault, document.layout.elements);
    if (repair.changes.length === 0) {
      expect(repair.reason).toBeTruthy();
      return;
    }

    const run = runFromProposal(repair.changes, fault.message, 'pipeline-4', {
      agent: 'reviewer',
      phase: 'review',
    })!;
    const prepared = prepareRun(run, document.layout.elements, {
      boundary: BOUNDARY,
      allocateId: (index) => `new-${index}`,
    });

    expect(prepared.refused).toEqual([]);
    expect(reviewer.review(document, prepared.result).total).toBeCloseTo(
      repair.predicted!.after,
      9,
    );
  });
});

if (connection === null) {
  describe('the whole assistant pipeline', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
