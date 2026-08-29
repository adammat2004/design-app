import { describe, expect, it } from 'vitest';
import { hashString, moduleRandom, mulberry32, pick } from './prng';

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('surface-a')).toBe(hashString('surface-a'));
  });

  it('separates the short, similar ids it is actually fed', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `element-${index}`);
    const hashes = new Set(ids.map(hashString));

    expect(hashes.size).toBe(ids.length);
  });

  it('stays inside 32 unsigned bits', () => {
    for (const text of ['', 'a', 'element-1', 'a much longer identifier than any real one']) {
      const hash = hashString(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });
});

describe('mulberry32', () => {
  it('replays the same sequence from the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);

    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b));
  });

  it('stays in the unit interval', () => {
    const random = mulberry32(7);

    for (let i = 0; i < 5000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform, so no palette entry is starved', () => {
    const random = mulberry32(99);
    const buckets = [0, 0, 0, 0, 0];

    for (let i = 0; i < 50_000; i += 1) buckets[Math.floor(random() * 5)]! += 1;

    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11_000);
    }
  });
});

describe('moduleRandom', () => {
  it('depends on the coordinates, not on the order modules are drawn in', () => {
    /*
     * The property acceptance criterion 5 rests on. A module's tone is a function of where it is,
     * so re-clipping a surface after a vertex drag cannot repaint the slabs that did not move.
     */
    expect(moduleRandom('a', 3, 4)()).toBe(moduleRandom('a', 3, 4)());
    expect(moduleRandom('a', 3, 4)()).not.toBe(moduleRandom('a', 4, 3)());
  });

  it('gives two surfaces different sequences at the same coordinates', () => {
    expect(moduleRandom('surface-a', 0, 0)()).not.toBe(moduleRandom('surface-b', 0, 0)());
  });

  it('handles negative coordinates', () => {
    // Routine as soon as a surface is re-anchored to an origin below or right of it.
    expect(moduleRandom('a', -2, -7)()).toBe(moduleRandom('a', -2, -7)());
    expect(moduleRandom('a', -2, -7)()).not.toBe(moduleRandom('a', 2, 7)());
  });

  it('does not correlate along a row', () => {
    // Neighbouring modules drawing the same tone would show up as visible banding.
    const row = Array.from({ length: 60 }, (_, col) => moduleRandom('a', col, 0)());
    const identicalNeighbours = row.filter((value, index) => index > 0 && value === row[index - 1]);

    expect(identicalNeighbours).toHaveLength(0);
  });
});

describe('pick', () => {
  it('covers every entry and never runs off the end', () => {
    const items = ['a', 'b', 'c'];

    expect(pick(items, 0)).toBe('a');
    expect(pick(items, 0.5)).toBe('b');
    // 1 is not a value mulberry32 can return, but clamping beats an undefined tone.
    expect(pick(items, 1)).toBe('c');
    expect(pick(items, 0.999999)).toBe('c');
  });

  it('refuses an empty list rather than returning undefined', () => {
    expect(() => pick([], 0.5)).toThrow();
  });
});
