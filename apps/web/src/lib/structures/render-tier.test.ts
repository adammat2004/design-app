import { describe, expect, it } from 'vitest';
import { hasFloatTargets, renderTier } from './render-tier';

describe('renderTier', () => {
  it('gives the post-processing pass only to a fine pointer that can render float colour', () => {
    expect(renderTier({ coarse: false, floatTargets: true })).toBe('high');
    expect(renderTier({ coarse: true, floatTargets: true })).toBe('low');
    expect(renderTier({ coarse: false, floatTargets: false })).toBe('low');
  });

  it('accepts either float colour extension', () => {
    const only = (name: string) => ({ has: (asked: string) => asked === name });
    expect(hasFloatTargets(only('EXT_color_buffer_float'))).toBe(true);
    expect(hasFloatTargets(only('EXT_color_buffer_half_float'))).toBe(true);
    expect(hasFloatTargets(only('OES_texture_float_linear'))).toBe(false);
  });
});
