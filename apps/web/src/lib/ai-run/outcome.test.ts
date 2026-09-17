import { describe, expect, it } from 'vitest';
import type { DesignElement, DesignIssue } from '@garden-studio/schema';
import { composeOutcome } from './outcome';
import type { ReviewOutcome } from './review-loop';

/**
 * What the designer says it did, against what the garden says it did.
 *
 * The whole reason this module exists is a defect: the old `summarise` counted the *proposal*, so a
 * request whose last two lines the planner refused still announced four changes. Every test here is
 * some version of "the number on screen is the number of things that are different".
 */

function patio(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-1',
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    zone: 'back',
    material: 'porcelain',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 4, depth: 3, rotation: 0 },
    ...over,
  } as DesignElement;
}

function bed(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-2',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    zone: 'back',
    material: 'shrubs',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 5 },
        { x: 2, y: 5 },
      ],
    },
    ...over,
  } as DesignElement;
}

function issue(message: string): DesignIssue {
  return {
    code: 'route-pinch',
    principle: 'circulation',
    severity: 'minor',
    message,
    subjects: ['e-3'],
    repair: 'widen-path',
    /* Which critic found it. One measures geometry today; a vision critic would stamp its own. */
    source: 'geometry',
  } satisfies DesignIssue;
}

function review(passes: { message: string; kept: boolean }[]): ReviewOutcome {
  return {
    passes: passes.map((pass) => ({
      issue: issue(pass.message),
      before: 0.8,
      after: pass.kept ? 0.9 : 0.8,
      played: true,
      considered: 3,
      reason: null,
      kept: pass.kept,
    })),
    verdict: passes.some((pass) => pass.kept) ? 'improved' : 'nothing-worked',
    score: null,
    offers: [],
  };
}

/*
 * Elements are compared by identity, because every store action replaces rather than mutates — a
 * bed nothing touched is the same object afterwards. So the fixtures below hold their references
 * and edit through a spread, exactly as the editor does.
 */
describe('composeOutcome', () => {
  it('counts what landed, not what was asked for', () => {
    const terrace = patio();
    const border = bed();
    const before = [terrace, border];
    /* Four lines were proposed; two were refused, so two things are actually different. */
    const after = [
      {
        ...terrace,
        shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 6, depth: 4, rotation: 0 },
      } as DesignElement,
      { ...border, material: 'mixed-border' } as DesignElement,
    ];

    const outcome = composeOutcome({
      initial: before,
      result: after,
      refused: [
        {
          label: 'Garden store',
          reason: 'There is no clear 2.5 × 2 m space left in the back garden.',
        },
        { label: 'Fire pit', reason: 'It would overlap the dining terrace.' },
      ],
    });

    expect(outcome.changed).toBe(2);
    expect(outcome.text).toBe('Done. 2 changes.');
    expect(outcome.refused).toHaveLength(2);
    expect(outcome.refused[0]!.reason).toContain('no clear');
  });

  it('says "1 change" rather than "1 changes"', () => {
    const terrace = patio();
    const outcome = composeOutcome({
      initial: [terrace],
      result: [{ ...terrace, material: 'stone-pavers' } as DesignElement],
      refused: [],
    });

    expect(outcome.text).toBe('Done. 1 change.');
  });

  it('counts an element that was removed', () => {
    const terrace = patio();
    const outcome = composeOutcome({ initial: [terrace, bed()], result: [terrace], refused: [] });
    expect(outcome.changed).toBe(1);
  });

  it('counts an element that was added', () => {
    const terrace = patio();
    const outcome = composeOutcome({
      initial: [terrace],
      result: [terrace, bed()],
      refused: [],
    });
    expect(outcome.changed).toBe(1);
  });

  it('reports a put-back pass as a put-back, not as a change', () => {
    const terrace = patio();
    const border = bed();
    const before = [terrace, border];
    const after = [{ ...terrace, material: 'stone-pavers' } as DesignElement, border];

    const outcome = composeOutcome({
      initial: before,
      result: after,
      refused: [],
      review: review([
        { message: 'The path to the store is pinched.', kept: true },
        { message: 'The store stands in the sightline.', kept: false },
      ]),
    });

    expect(outcome.review?.verdict).toBe('improved');
    expect(
      outcome.review?.passes.filter((pass) => pass.kept).map((pass) => pass.issue.message),
    ).toEqual(['The path to the store is pinched.']);
    expect(
      outcome.review?.passes.filter((pass) => !pass.kept).map((pass) => pass.issue.message),
    ).toEqual(['The store stands in the sightline.']);
    /* The score either side of the kept pass survives, because it is the evidence for the claim. */
    expect(outcome.review?.passes[0]).toMatchObject({ before: 0.8, after: 0.9 });
    expect(outcome.text).toContain('The reviewer also fixed 1 thing.');
    expect(outcome.text).toContain('put it back');
  });

  it('says the reviewer found nothing when it found nothing', () => {
    const terrace = patio();
    const outcome = composeOutcome({
      initial: [terrace],
      result: [{ ...terrace, material: 'stone-pavers' } as DesignElement],
      refused: [],
      review: { passes: [], verdict: 'nothing-to-fix', score: null, offers: [] },
    });

    expect(outcome.text).toContain('nothing else to improve');
  });

  /*
   * Stop keeps what has landed, so the sentence has to say so. "Stopped." on its own reads as
   * "nothing happened", which would have the user pressing Undo on a garden they wanted.
   */
  it('says what a stopped run kept', () => {
    const terrace = patio();
    const border = bed();
    const outcome = composeOutcome({
      initial: [terrace, border],
      result: [{ ...terrace, material: 'stone-pavers' } as DesignElement, border],
      refused: [],
      stopped: true,
    });

    expect(outcome.stopped).toBe(true);
    expect(outcome.text).toBe('Stopped part way — 1 change kept.');
  });

  it('says plainly when a stopped run had done nothing yet', () => {
    const before = [patio()];
    const outcome = composeOutcome({
      initial: before,
      result: before,
      refused: [],
      stopped: true,
    });

    expect(outcome.changed).toBe(0);
    expect(outcome.text).toBe('Stopped before anything changed.');
  });

  it('says plainly when a completed run changed nothing', () => {
    const before = [patio()];
    const outcome = composeOutcome({ initial: before, result: before, refused: [] });
    expect(outcome.text).toBe('Nothing on the plan changed.');
  });
});
