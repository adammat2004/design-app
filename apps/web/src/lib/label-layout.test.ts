import { describe, expect, it } from 'vitest';
import { CHIP_HEIGHT, LABEL_HEIGHT, LEADER_MIN_PX, stackLabels } from './label-layout';

const SIZE = { width: 800, height: 600 };

const label = (x: number, y: number, full = true) => ({ at: { x, y }, full });

describe('stackLabels', () => {
  it('leaves a label where it is when nothing is in the way', () => {
    const [only] = stackLabels([label(100, 100)], SIZE);

    expect(only!.at).toEqual({ x: 100, y: 100 });
    expect(only!.displaced).toBe(false);
  });

  it('pushes the lower of two colliding labels clear', () => {
    const [first, second] = stackLabels([label(100, 100), label(100, 105)], SIZE);

    expect(first!.at.y).toBe(100);
    expect(second!.at.y).toBe(100 + LABEL_HEIGHT);
  });

  it('reserves less room for a collapsed chip than for a full block', () => {
    const [, afterChip] = stackLabels([label(100, 100, false), label(100, 105)], SIZE);

    expect(afterChip!.at.y).toBe(100 + CHIP_HEIGHT);
  });

  it('drops anything off screen', () => {
    expect(stackLabels([label(-500, 100), label(100, 100)], SIZE)).toHaveLength(1);
  });
});

describe('the anchor a leader is drawn to', () => {
  /**
   * The defect this closes.
   *
   * `stackLabels` used to overwrite `at` with the stacked position and throw the original away, so
   * a label that had been pushed clear of a collision was left pointing at nothing in particular.
   * On a plan with five or six labelled features — most plans — that is the common case, and the
   * reader ends up matching names to shapes by guesswork.
   */
  it('remembers where the thing being labelled actually is', () => {
    const [, pushed] = stackLabels([label(100, 100), label(100, 105)], SIZE);

    expect(pushed!.anchor).toEqual({ x: 100, y: 105 });
    expect(pushed!.at.y).toBeGreaterThan(pushed!.anchor.y);
  });

  it('asks for a leader once the label has genuinely moved away', () => {
    const [, pushed] = stackLabels([label(100, 100), label(100, 105)], SIZE);

    expect(pushed!.displaced).toBe(true);
  });

  it('does not ask for one when the label still covers its own subject', () => {
    // A line from a thing to itself is a mark this drawing does not need.
    const nudge = LEADER_MIN_PX - 1;
    const [, barelyMoved] = stackLabels(
      [label(100, 100, false), label(100, 100 + CHIP_HEIGHT - nudge, false)],
      SIZE,
    );

    expect(barelyMoved!.displaced).toBe(false);
  });

  it('never moves a label sideways, which is what lets the leader be vertical', () => {
    // `LabelLeader` draws a vertical line. If this ever gains horizontal nudging, that has to
    // become a real two-point line.
    const stacked = stackLabels([label(100, 100), label(100, 105), label(100, 110)], SIZE);

    for (const entry of stacked) expect(entry.at.x).toBe(entry.anchor.x);
  });
});
