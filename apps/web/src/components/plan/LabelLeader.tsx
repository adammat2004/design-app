import type { Point } from '@garden-studio/schema';

/**
 * The line from a displaced label back to the thing it names.
 *
 * `stackLabels` resolves collisions by pushing labels down the screen. That is the right fix for
 * the collision and it creates a second problem: a label that has moved is a label pointing at
 * nothing. On a plan with five or six labelled features — which is most plans — that is the common
 * case, and the reader is left matching names to shapes by guesswork.
 *
 * Drawn only when the label was actually pushed (`LEADER_MIN_PX`). A leader from a label to the
 * thing directly underneath it is a mark from something to itself, and this drawing earns most of
 * its clarity from restraint.
 *
 * The line is vertical because the displacement is: `stackLabels` only ever moves a label down,
 * never sideways. If it ever gains horizontal nudging this has to become a real two-point line.
 *
 * A dot at the far end, following drafting convention — a bare line stopping in open ground is
 * ambiguous about which of two nearby shapes it means.
 */
export function LabelLeader({ anchor, at }: { anchor: Point; at: Point }) {
  const top = Math.min(anchor.y, at.y);
  const height = Math.abs(at.y - anchor.y);

  return (
    <>
      <span
        aria-hidden
        data-testid="label-leader"
        style={{ left: anchor.x, top, height }}
        className="absolute w-px -translate-x-1/2 bg-garden-muted/50"
      />
      <span
        aria-hidden
        style={{ left: anchor.x, top: anchor.y }}
        className="absolute h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-garden-muted/70"
      />
    </>
  );
}
