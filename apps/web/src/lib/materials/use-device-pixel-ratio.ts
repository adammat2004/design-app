'use client';

import { useEffect, useState } from 'react';

/**
 * How many device pixels the display puts behind one CSS pixel, clamped.
 *
 * Konva renders its stage's backing store at `devicePixelRatio` and every vector thing it draws —
 * the grid, the fence, the boundary, every stroke and handle — comes out at that density. The
 * cached surface rasters did not: they were allocated from `CanvasTransform.scale`, which is CSS
 * pixels per metre, and then upscaled by the stage. So on any Retina-class display every procedural
 * texture in the app was drawn at half the density it was shown at, next to strokes that were not.
 * That is the whole of the "why does this look slightly soft" complaint, and it is not a tuning
 * problem — the pixels were never there.
 *
 * Clamped at 2 deliberately. A raster's cost is the square of this, so a 3× phone display would
 * triple the memory of every surface in the plan for a difference nobody can see at arm's length —
 * and this editor is optimised for large screens first.
 */
export const MAX_PIXEL_RATIO = 2;

/** What to use where there is no window: the server, and the node-side composer's tests. */
export const DEFAULT_PIXEL_RATIO = 1;

export function devicePixelRatioNow(): number {
  if (typeof window === 'undefined') return DEFAULT_PIXEL_RATIO;

  return Math.min(window.devicePixelRatio || DEFAULT_PIXEL_RATIO, MAX_PIXEL_RATIO);
}

/**
 * The live device pixel ratio.
 *
 * Read eagerly rather than in an effect. Every caller of this is inside a canvas that is already
 * behind `dynamic(..., { ssr: false })`, so there is no server render to disagree with — and
 * initialising to 1 and correcting in an effect would regenerate every raster in the plan once on
 * mount, which is the exact cost this hook exists to avoid paying twice.
 *
 * The listener is for dragging the window between a laptop screen and an external monitor, which
 * changes `devicePixelRatio` with no resize and no re-render. `matchMedia` has to be re-armed after
 * each change because the query names the ratio it is watching for.
 */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(devicePixelRatioNow);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    let query: MediaQueryList | null = null;

    const onChange = () => {
      setRatio(devicePixelRatioNow());
      arm();
    };

    const arm = () => {
      query?.removeEventListener('change', onChange);
      // The unclamped ratio, because this is asking "has the display changed", not "how much
      // detail do we draw" — a move from 2× to 3× must still re-arm on the right query.
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', onChange);
    };

    arm();

    return () => query?.removeEventListener('change', onChange);
  }, []);

  return ratio;
}
