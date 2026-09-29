import { describe, expect, it, vi } from 'vitest';
import { webglAvailable } from './webgl';

const documentWith = (getContext: (kind: string) => unknown) =>
  ({ createElement: () => ({ getContext }) }) as unknown as Pick<Document, 'createElement'>;

describe('webglAvailable', () => {
  it('says yes when a context comes up, and releases the probe', () => {
    const loseContext = vi.fn();
    const context = { getExtension: () => ({ loseContext }) };
    expect(webglAvailable(documentWith((kind) => (kind === 'webgl2' ? context : null)))).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('falls back to WebGL 1', () => {
    const context = { getExtension: () => null };
    expect(webglAvailable(documentWith((kind) => (kind === 'webgl' ? context : null)))).toBe(true);
  });

  it('says no when neither comes up, or the probe throws', () => {
    expect(webglAvailable(documentWith(() => null))).toBe(false);
    expect(
      webglAvailable(
        documentWith(() => {
          throw new Error('blocked');
        }),
      ),
    ).toBe(false);
  });

  // jsdom has no WebGL, which is exactly the browser this state exists for.
  it('says no in jsdom', () => {
    expect(webglAvailable()).toBe(false);
  });
});
