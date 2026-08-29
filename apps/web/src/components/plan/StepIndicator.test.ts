import { describe, expect, it } from 'vitest';
import { PLAN_STEPS } from './StepIndicator';

describe('PLAN_STEPS', () => {
  it('is the six-step flow, numbered in order', () => {
    expect(PLAN_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('names every step distinctly', () => {
    expect(new Set(PLAN_STEPS.map((step) => step.label)).size).toBe(PLAN_STEPS.length);
    expect(new Set(PLAN_STEPS.map((step) => step.step)).size).toBe(PLAN_STEPS.length);
  });

  it('points the fourth step at the concepts screen', () => {
    expect(PLAN_STEPS[3]).toEqual({ number: 4, label: 'Design concepts', step: 'concepts' });
  });

  it('points the fifth step at the editor', () => {
    expect(PLAN_STEPS[4]).toEqual({ number: 5, label: 'Editor', step: 'editor' });
  });

  it('points the unbuilt sixth step at its placeholder', () => {
    expect(PLAN_STEPS[5]).toEqual({ number: 6, label: 'Review', step: 'review' });
  });

  /*
   * Slugs, not hrefs: every wizard URL is scoped to a project, so a finished href here would be
   * a second place that knows how to build one.
   */
  it('carries step slugs rather than assembled URLs', () => {
    for (const step of PLAN_STEPS) {
      expect(step.step).not.toContain('/');
    }
  });
});
