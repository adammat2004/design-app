import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PURPOSE_LIMIT } from '@/lib/brief';
import { resetBriefStoreForTests, useBriefStore } from './brief-store';

function brief() {
  return useBriefStore.getState().present;
}

describe('the brief store', () => {
  beforeEach(() => {
    resetBriefStoreForTests();
  });

  it('starts on an unanswered brief', () => {
    expect(brief().budget).toBeNull();
    expect(brief().desiredFeatures).toEqual([]);
  });

  it('toggles a desired feature on and off', () => {
    useBriefStore.getState().toggleFeature('seating');
    expect(brief().desiredFeatures).toEqual(['seating']);

    useBriefStore.getState().toggleFeature('seating');
    expect(brief().desiredFeatures).toEqual([]);
  });

  it('throws away the Other text when Other is un-ticked', () => {
    useBriefStore.getState().toggleFeature('other');
    useBriefStore.getState().setFeaturesOther('A hot tub');
    expect(brief().featuresOther).toBe('A hot tub');

    useBriefStore.getState().toggleFeature('other');
    expect(brief().featuresOther).toBe('');
  });

  it('throws away the style Other text when a real style is chosen', () => {
    useBriefStore.getState().setStyle('other');
    useBriefStore.getState().setStyleOther('Japanese');

    useBriefStore.getState().setStyle('formal');
    expect(brief().styleOther).toBe('');
  });

  it('truncates a purpose pasted over the cap', () => {
    useBriefStore.getState().setPurpose('x'.repeat(PURPOSE_LIMIT + 100));

    expect(brief().purpose).toHaveLength(PURPOSE_LIMIT);
  });

  it('replaces a single-select answer rather than clearing it', () => {
    useBriefStore.getState().setBudget('medium');
    useBriefStore.getState().setBudget('medium');
    expect(brief().budget).toBe('medium');

    useBriefStore.getState().setBudget('premium');
    expect(brief().budget).toBe('premium');
  });
});

describe('the brief store save stamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBriefStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances on a real edit', () => {
    const before = useBriefStore.getState().lastSavedAt;

    vi.advanceTimersByTime(1000);
    useBriefStore.getState().setBudget('low');

    expect(useBriefStore.getState().lastSavedAt).toBeGreaterThan(before);
  });

  it('stays put when an edit changes nothing', () => {
    useBriefStore.getState().setBudget('low');
    const after = useBriefStore.getState().lastSavedAt;

    vi.advanceTimersByTime(1000);
    useBriefStore.getState().setBudget('low');

    expect(useBriefStore.getState().lastSavedAt).toBe(after);
  });
});
