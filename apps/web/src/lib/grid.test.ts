import { describe, expect, it } from 'vitest';
import {
  formatViewportSpan,
  gridSteps,
  niceStep,
  SNAP_STEP,
  snapPoint,
  snapToStep,
  viewportSpan,
} from './grid';
import { METRES_PER_FOOT } from './units';

describe('niceStep', () => {
  it('picks a bigger step as the view zooms out', () => {
    const zoomedIn = niceStep(120, 'm', 40);
    const zoomedOut = niceStep(4, 'm', 40);

    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });

  it('never returns a step wider than the budget while one is available', () => {
    for (const scale of [4, 12, 32, 80]) {
      expect(niceStep(scale, 'm', 40) * scale).toBeLessThanOrEqual(40);
    }
  });

  it('measures the budget in display units, so feet give a different step', () => {
    // At the same zoom a foot is a third of a metre, so more feet fit in the same pixels.
    expect(niceStep(32, 'ft', 40)).toBeGreaterThanOrEqual(niceStep(32, 'm', 40));
  });

  it('falls back to the finest step when zoomed in past the whole ladder', () => {
    expect(niceStep(10000, 'm', 40)).toBe(0.25);
  });

  it('caps at the coarsest step when zoomed out past the whole ladder', () => {
    expect(niceStep(0.001, 'm', 40)).toBe(200);
  });
});

describe('gridSteps', () => {
  it('draws a heavier line every five boxes', () => {
    const { minor, major } = gridSteps(32, 'm');
    expect(major).toBe(minor * 5);
  });
});

describe('viewportSpan', () => {
  it('is the stage width divided by the scale', () => {
    // 960 px at 32 px per metre is 30 m of ground.
    expect(viewportSpan(960, 32)).toBeCloseTo(30);
  });

  it('shows less ground as the view zooms in', () => {
    expect(viewportSpan(960, 64)).toBeLessThan(viewportSpan(960, 32));
  });

  /*
   * The reading this replaced was `scale / DEFAULT_SCALE`, which is undefined at scale 0 in a
   * different way: it read 0%. A stage that has not been measured yet has no span at all.
   */
  it('is zero before the stage has been measured', () => {
    expect(viewportSpan(960, 0)).toBe(0);
    expect(viewportSpan(0, 32)).toBe(0);
  });
});

describe('formatViewportSpan', () => {
  it('reads in whole units once there is a useful amount of ground', () => {
    expect(formatViewportSpan(30, 'm')).toBe('30 m across');
    expect(formatViewportSpan(23.6, 'm')).toBe('24 m across');
  });

  it('keeps a decimal place when zoomed right in', () => {
    expect(formatViewportSpan(4.28, 'm')).toBe('4.3 m across');
  });

  it('converts for a user reading feet', () => {
    // 30 m is a little over 98 ft, and the label has to say so rather than quoting metres.
    expect(formatViewportSpan(30, 'ft')).toBe('98 ft across');
  });
});

describe('snapToStep', () => {
  it('rounds to the nearest half metre', () => {
    expect(snapToStep(12.63, 'm')).toBeCloseTo(12.5);
    expect(snapToStep(12.44, 'm')).toBeCloseTo(12.5);
    expect(snapToStep(12.8, 'm')).toBeCloseTo(13);
  });

  it('rounds to half a foot when the user is reading feet', () => {
    // 10.2 ft is 3.10896 m; the nearest half foot is 10.0 ft.
    expect(snapToStep(10.2 * METRES_PER_FOOT, 'ft')).toBeCloseTo(10 * METRES_PER_FOOT);
  });

  it('is idempotent', () => {
    const once = snapToStep(7.31, 'm');
    expect(snapToStep(once, 'm')).toBeCloseTo(once);
  });

  it('handles negative coordinates', () => {
    expect(snapToStep(-3.4, 'm')).toBeCloseTo(-3.5);
  });

  it('never moves a point further than half a step', () => {
    for (const value of [0.1, 3.33, 9.87, 21.04]) {
      expect(Math.abs(snapToStep(value, 'm') - value)).toBeLessThanOrEqual(SNAP_STEP / 2 + 1e-9);
    }
  });
});

describe('snapPoint', () => {
  it('snaps both axes', () => {
    const snapped = snapPoint({ x: 4.2, y: 9.9 }, 'm');

    expect(snapped.x).toBeCloseTo(4);
    expect(snapped.y).toBeCloseTo(10);
  });
});
