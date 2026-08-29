import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './use-relative-time';

const NOW = 1_700_000_000_000;
const at = (secondsAgo: number) => formatRelativeTime(NOW - secondsAgo * 1000, NOW);

describe('formatRelativeTime', () => {
  it('says "just now" for the first three quarters of a minute', () => {
    expect(at(0)).toBe('just now');
    expect(at(44)).toBe('just now');
  });

  it('counts minutes', () => {
    expect(at(120)).toBe('2 min ago');
    expect(at(59 * 60)).toBe('59 min ago');
  });

  it('counts hours, singular and plural', () => {
    expect(at(60 * 60)).toBe('1 hour ago');
    expect(at(5 * 60 * 60)).toBe('5 hours ago');
  });

  it('counts days', () => {
    expect(at(24 * 60 * 60)).toBe('1 day ago');
    expect(at(3 * 24 * 60 * 60)).toBe('3 days ago');
  });

  it('never counts backwards from a clock that has drifted', () => {
    expect(formatRelativeTime(NOW + 5000, NOW)).toBe('just now');
  });
});
