import { describe, expect, it } from 'vitest';
import { isStageDrag } from './use-canvas-viewport';

describe('isStageDrag', () => {
  it('accepts a drag whose target is the Stage', () => {
    const stage = {
      getStage() {
        return this;
      },
    };
    expect(isStageDrag({ target: stage })).toBe(true);
  });

  it('refuses a bubbled child dragend', () => {
    const stage = {
      getStage() {
        return this;
      },
    };
    const group = { getStage: () => stage };
    expect(isStageDrag({ target: group })).toBe(false);
  });
});
