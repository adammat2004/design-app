'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Point } from '@garden-studio/schema';
import { clamp, fitTransform, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';

/** Pixels per metre before the user has zoomed or fitted anything. */
export const DEFAULT_SCALE = 32;
export const MIN_SCALE = 4;
export const MAX_SCALE = 400;

/**
 * Breathing room around a fitted shape, as a fraction of the canvas's shorter side. Proportional
 * rather than a flat pixel count so the framing looks the same on a laptop and on a wide monitor.
 */
export const FIT_PADDING_RATIO = 0.12;

/**
 * Zoom below which placed features collapse to icon chips: no text label, no edit handles. Named
 * because it will want tuning — everything reads it from here rather than comparing scales inline.
 * Expressed as a fraction of `DEFAULT_SCALE`, which is what the zoom readout shows as 100%.
 */
export const DETAIL_ZOOM = 0.8;
export const DETAIL_SCALE = DEFAULT_SCALE * DETAIL_ZOOM;

/** How close together, in time and pixels, two taps have to be to arm a pan while drawing. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 8;

/** A rectangle dragged out smaller than this is treated as a click, not a drag. */
export const DRAG_THRESHOLD_PX = 12;

/**
 * How much of the remaining distance to the zoom target is covered each frame. High enough that
 * a click on + lands almost immediately, low enough that a fast scroll reads as one continuous
 * movement rather than a stack of jumps.
 */
const ZOOM_EASE = 0.25;

/** Below this the eased value has arrived; snapping to the target stops an endless rAF loop. */
const ZOOM_SETTLED = 0.05;

/**
 * Everything about *looking* at the plan, as opposed to editing it: how big the stage is, how
 * many pixels a metre is worth, where the origin sits, and whether dragging pans or draws.
 *
 * The polygon to frame arrives as a callback rather than a value because the resize observer
 * below outlives any one render — reading the shape through a captured prop would refit to
 * whatever the geometry was when the observer was attached.
 */
export function useCanvasViewport({ getPolygon }: { getPolygon: () => Point[] }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ scale: DEFAULT_SCALE, offsetX: 0, offsetY: 0 });
  const [panning, setPanning] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const hasFitted = useRef(false);

  const transform = useMemo<CanvasTransform>(
    () => ({ ...viewport, stageWidth: size.width, stageHeight: size.height }),
    [viewport, size.width, size.height],
  );

  /*
   * Held in a ref, refreshed before the observer below attaches, so `fitToShape` can stay
   * stable across renders. Callers pass a fresh closure every render; depending on it directly
   * would tear down and rebuild the resize observer on each one.
   */
  const polygonRef = useRef(getPolygon);
  useLayoutEffect(() => {
    polygonRef.current = getPolygon;
  });

  /*
   * Zoom runs against a target rather than the live viewport, with a frame loop easing towards
   * it. A fast scroll fires a burst of wheel events; applying each one straight to the viewport
   * makes the plan jump in visible steps, whereas folding them all into one target and chasing
   * it reads as a single continuous movement. The +/-, fit and wheel paths all drive the same
   * target, so they all ease.
   */
  const targetRef = useRef(viewport);
  const frameRef = useRef<number | null>(null);

  const runEase = useCallback(() => {
    if (frameRef.current !== null) return;

    const step = () => {
      let settled = false;

      setViewport((current) => {
        const target = targetRef.current;
        const scale = current.scale + (target.scale - current.scale) * ZOOM_EASE;
        const offsetX = current.offsetX + (target.offsetX - current.offsetX) * ZOOM_EASE;
        const offsetY = current.offsetY + (target.offsetY - current.offsetY) * ZOOM_EASE;

        if (
          Math.abs(target.scale - scale) < ZOOM_SETTLED &&
          Math.abs(target.offsetX - offsetX) < ZOOM_SETTLED &&
          Math.abs(target.offsetY - offsetY) < ZOOM_SETTLED
        ) {
          settled = true;
          return target;
        }

        return { scale, offsetX, offsetY };
      });

      frameRef.current = settled ? null : requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const fitToShape = useCallback(
    (width: number, height: number, options?: { immediate?: boolean }) => {
      if (width === 0 || height === 0) return;

      const current = polygonRef.current();

      const next =
        current.length < 2
          ? // Nothing to frame yet, so put the metre origin in the middle and let the user draw
            // outwards from there.
            { scale: DEFAULT_SCALE, offsetX: width / 2, offsetY: height / 2 }
          : (() => {
              const fitted = fitTransform(current, {
                width,
                height,
                padding: Math.min(width, height) * FIT_PADDING_RATIO,
              });
              return {
                scale: clamp(fitted.scale, MIN_SCALE, MAX_SCALE),
                offsetX: fitted.offsetX,
                offsetY: fitted.offsetY,
              };
            })();

      targetRef.current = next;

      // The first fit has nowhere to ease from — it would slide in from an arbitrary default.
      if (options?.immediate) {
        setViewport(next);
        return;
      }

      runEase();
    },
    [runEase],
  );

  useLayoutEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize({ width, height });

      /*
       * Fit once, as soon as the stage has a size. After that the viewport belongs to the
       * user: re-fitting on every change would slide already-placed corners out from under
       * the cursor mid-draw.
       */
      if (!hasFitted.current && width > 0 && height > 0) {
        hasFitted.current = true;
        fitToShape(width, height, { immediate: true });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [fitToShape]);

  /** Zooms about a fixed point in stage pixels, so what is under the cursor stays there. */
  const zoomAbout = useCallback(
    (factor: number, focus: Point) => {
      const current = targetRef.current;
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;

      targetRef.current = {
        scale,
        offsetX: focus.x - (focus.x - current.offsetX) * ratio,
        offsetY: focus.y - (focus.y - current.offsetY) * ratio,
      };

      runEase();
    },
    [runEase],
  );

  /**
   * Folds the stage's own offset back into the viewport so every other calculation can keep
   * assuming the stage sits at the origin.
   *
   * Panning is applied straight through with no easing: it tracks the cursor 1:1 and stops dead
   * on release, because on a measurement surface a view that keeps gliding makes it harder to
   * park on the corner you were aiming at. The zoom target is moved along with it so a later
   * zoom does not snap the view back to where the pan started.
   */
  const foldStageOffset = useCallback(
    (stage: { x(): number; y(): number; position(p: { x: number; y: number }): void }) => {
      const dx = stage.x();
      const dy = stage.y();

      targetRef.current = {
        ...targetRef.current,
        offsetX: targetRef.current.offsetX + dx,
        offsetY: targetRef.current.offsetY + dy,
      };

      setViewport((current) => ({
        ...current,
        offsetX: current.offsetX + dx,
        offsetY: current.offsetY + dy,
      }));
      stage.position({ x: 0, y: 0 });
    },
    [],
  );

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const position = stageRef.current?.getPointerPosition();
      if (!position) return;
      zoomAbout(event.evt.deltaY < 0 ? 1.08 : 1 / 1.08, position);
    },
    [zoomAbout],
  );

  /** Where the cursor is, in metres. Null before the stage has seen a pointer. */
  const pointerInMetres = useCallback((): Point | null => {
    const position = stageRef.current?.getPointerPosition();
    return position ? pxToMetres(position, transform) : null;
  }, [transform]);

  /*
   * Holding space turns any drag into a pan, the way every drawing tool does it, without giving
   * up the tool you had selected. Listening on the window rather than the canvas means it works
   * whether or not the canvas has focus, and the keyup is guarded so a space typed into a text
   * field elsewhere on the screen cannot leave the canvas stuck in pan mode.
   */
  const [spaceHeld, setSpaceHeld] = useState(false);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT');

    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      // Space would otherwise scroll the page out from under the plan.
      event.preventDefault();
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    // Alt-tabbing away with space down would otherwise never deliver the keyup.
    const blur = () => setSpaceHeld(false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** Middle-mouse-drag pans too, for the hand that never leaves the mouse. */
  const [middleHeld, setMiddleHeld] = useState(false);

  const handlePointerDown = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.evt.button !== 1) return false;
    event.evt.preventDefault();
    setMiddleHeld(true);
    return true;
  }, []);

  const handlePointerUp = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.evt.button === 1) setMiddleHeld(false);
  }, []);

  /** Whether an explicit pan gesture is being held — the toggle, space, or the middle button. */
  const panActive = panning || spaceHeld || middleHeld;

  /*
   * Dragging empty canvas pans by default, with no tool to select first. Konva decides whether a
   * node drags when the pointer goes down, but React state set in the same handler has not landed
   * by then — so the stage is left permanently draggable and the drag is vetoed on dragstart
   * instead. `allowPan` is a ref for the same reason: it has to be readable synchronously.
   *
   * Dragging a feature is unaffected either way, because Konva drags the topmost draggable node
   * under the pointer, which is the feature's own group rather than the stage.
   */
  const allowPan = useRef(true);
  const didPan = useRef(false);

  const armPan = useCallback((allowed: boolean) => {
    allowPan.current = allowed;
    /*
     * Cleared as every gesture begins, so the flag can only ever swallow the click belonging to
     * the pan that set it. Relying on a closing stage click to clear it would latch it on any
     * pan that ended over a shape or off the edge, and eat the next click the user made.
     */
    didPan.current = false;
  }, []);

  const handleStageDragStart = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    if (event.target !== event.target.getStage()) return;

    if (!allowPan.current) {
      event.target.stopDrag();
      return;
    }

    didPan.current = true;
  }, []);

  /**
   * True for the click that ends a pan, so the caller can swallow it — otherwise letting go of a
   * pan would drop a stray vertex or clear the selection. Reading it clears it.
   */
  const consumePan = useCallback(() => {
    const panned = didPan.current;
    didPan.current = false;
    return panned;
  }, []);

  /*
   * While a shape is being drawn, a plain click has to keep meaning "put a point here", so
   * panning needs a gesture of its own: tap again on the spot you just clicked and hold. Both
   * canvases draw shapes, so the bookkeeping lives here rather than once per screen.
   */
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const registerTap = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    lastTap.current = { at: event.evt.timeStamp, x: event.evt.clientX, y: event.evt.clientY };
  }, []);

  const isDoubleTap = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    const previous = lastTap.current;
    if (!previous) return false;

    const near =
      event.evt.timeStamp - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(event.evt.clientX - previous.x, event.evt.clientY - previous.y) <=
        DOUBLE_TAP_SLOP_PX;

    // Consumed either way, so a third press does not read as another double tap.
    if (near) lastTap.current = null;
    return near;
  }, []);

  return {
    wrapperRef,
    stageRef,
    size,
    viewport,
    transform,
    panning,
    panActive,
    setPanning,
    handlePointerDown,
    handlePointerUp,
    armPan,
    handleStageDragStart,
    consumePan,
    registerTap,
    isDoubleTap,
    /** Zoomed in far enough to show labels, dimensions and edit handles. */
    detailed: viewport.scale >= DETAIL_SCALE,
    canRender: size.width > 0 && size.height > 0,
    stageCentre: { x: size.width / 2, y: size.height / 2 },
    fitToShape,
    zoomAbout,
    foldStageOffset,
    handleWheel,
    pointerInMetres,
  };
}
