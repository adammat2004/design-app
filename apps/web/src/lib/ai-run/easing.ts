/**
 * Three curves, and deliberately only three.
 *
 * A motion system with a curve per effect reads as a set of unrelated animations sharing a screen.
 * One curve for arriving, one for changing, one for popping is enough vocabulary for everything the
 * design agent does, and it is what makes a run composed by a model move like a run written by hand.
 *
 * Every one of them is a pure function of a clamped 0–1 progress, so the whole motion layer stays a
 * function of the clock — which is what makes the run scrubbable, and Replay a re-run rather than a
 * recording.
 */

export type Easing = (p: number) => number;

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Arriving: fast, then settling. Fades, selections, anything appearing. */
export const easeOutCubic: Easing = (p) => 1 - (1 - clamp01(p)) ** 3;

/** Changing: eased at both ends. Every geometry transform uses this. */
export const easeInOutCubic: Easing = (p) => {
  const t = clamp01(p);
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

/**
 * Popping: overshoots and comes back. Only for something arriving that was not there before.
 *
 * Never for a move or a resize — overshoot on an existing object reads as the plan wobbling, and
 * on a *measured* drawing that is worse than merely ugly: for a few frames the thing is drawn at a
 * size the plan does not say it is. An `add` is safe because the overshoot is applied to the Konva
 * node's scale and never to the geometry.
 */
export const easeOutBack: Easing = (p) => {
  const c1 = 1.70158;
  const t = clamp01(p) - 1;
  return 1 + (c1 + 1) * t ** 3 + c1 * t ** 2;
};

/** Where `t` falls within a window, 0 before it and 1 after. */
export function progress(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / duration);
}

/**
 * A fade that is in at one end of a window and out at the other.
 *
 * Overlays live and die by this: a selection outline that snapped on and off would read as a bug in
 * the canvas rather than as attention moving.
 */
export function windowFade(t: number, start: number, end: number, fade = 200): number {
  const rising = easeOutCubic(progress(t, start, fade));
  const falling = 1 - easeOutCubic(progress(t, Math.max(start, end - fade), fade));
  return Math.min(rising, falling);
}

export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

export function lerpPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: number,
): { x: number; y: number } {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
}

/** How long the cursor takes to travel to whatever it is about to work on. */
export const CURSOR_TRAVEL = 450;
