'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { boundingBox, type Point } from '@garden-studio/schema';
import { draftPolygon } from '@/lib/boundary-geometry';
import { buildRenderScene } from '@/lib/render/build-scene';
import { SceneRenderer, type ViewSize, type ViewTransform } from '@/lib/render/pixi/renderer';
import { drawOverlay, type PlanContext } from '@/lib/materials/render-plan';
import type { MakeCanvas, PatternCanvas } from '@/lib/materials/render-surface-pattern';
import { getAssetVariants } from '@/lib/materials/assets/registry';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { useAssetVersion } from '@/lib/materials/assets/use-assets';

/**
 * Visualise, drawn by WebGL and driven live.
 *
 * ## Why this is a view rather than a picture
 *
 * It used to be an `<img>` of a one-shot PNG, which was the right shape while Visualise was "the
 * plan without the editor on top of it". It is not the right shape for the thing it has become:
 * planting that answers to a maturity setting and lighting that answers to a time of day are only
 * worth having if you can *move* them and watch the garden change. A still cannot be interrogated.
 *
 * That is also the whole justification for the WebGL backend. A mature garden is a few thousand
 * plant sprites; Canvas2D can lay those down once for an export, but not sixty times a second
 * while somebody drags a slider.
 *
 * ## What it must not do
 *
 * Switching between 2D Plan and Visualise must not regenerate or alter the design — they are two
 * views over one plan. Nothing here writes to the layout: it reads the same stores the editor
 * reads and asks `buildRenderScene` for a different *picture* of them. The one thing it does write
 * is `site.sun`, and that is deliberate and pre-existing: which hour the plan is drawn at is a
 * design decision of the same kind as which way the decking runs, so it belongs on the document
 * and has to survive a reload.
 */
const ZOOM_STEP = 1.12;
const MIN_PX_PER_METRE = 4;
const MAX_PX_PER_METRE = 400;
const FIT_PADDING = 0.9;

export function VisualiseView() {
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const maturity = usePlanEditorStore((state) => state.maturity);
  const assetVersion = useAssetVersion();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const [ready, setReady] = useState(false);
  /** Flipped once the wrapper has been laid out, which is what lets the mount effect run. */
  const [sized, setSized] = useState(false);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<ViewTransform | null>(null);
  const drag = useRef<{ x: number; y: number; centre: Point } | null>(null);

  const boundary = draftPolygon(boundaryDraft);

  /*
   * Mount the WebGL context once, and tear it down properly — a leaked context is a lost tab.
   *
   * Deliberately waits for the wrapper to have a real size. A WebGL context initialised at 0 x 0
   * does not fail loudly: it comes up, fails to compile its shaders, and reports a lost context —
   * which reads as "WebGL is broken here" when the truth is that the element had not been laid
   * out yet. Cheap to wait for, and it means the panel can be mounted hidden without breaking.
   */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (wrapper.clientWidth === 0 || wrapper.clientHeight === 0) {
      const observer = new ResizeObserver(() => {
        if (wrapper.clientWidth > 0 && wrapper.clientHeight > 0) {
          observer.disconnect();
          setSized(true);
        }
      });
      observer.observe(wrapper);
      return () => observer.disconnect();
    }

    /*
     * The canvas is created here rather than rendered in JSX, and that is not a style choice.
     *
     * A canvas hands out one drawing context for its lifetime. React deliberately mounts, cleans
     * up and mounts again in development, so a canvas owned by JSX is handed to a second Pixi
     * `Application` after the first has destroyed its context — which comes up, fails to compile
     * every shader and reports a lost context. It is indistinguishable from a browser without
     * WebGL, and it only happens in development, so it looks like a bundler problem. A fresh
     * element per mount removes the question.
     */
    const canvas = document.createElement('canvas');
    canvas.className = 'h-full w-full cursor-grab active:cursor-grabbing';
    wrapper.prepend(canvas);

    let live = true;
    const renderer = new SceneRenderer();

    void (async () => {
      try {
        await renderer.mount(canvas, wrapper.clientWidth, wrapper.clientHeight);
        if (!live) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        setReady(true);
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
      rendererRef.current = null;
      renderer.destroy();
      canvas.remove();
    };
  }, [sized]);

  /* Fit the plot once there is something to fit and somewhere to fit it into. */
  useEffect(() => {
    if (!ready || view || boundary.length < 3) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const box = boundingBox(boundary);
    const scale = Math.min(
      (wrapper.clientWidth / Math.max(box.width, 0.001)) * FIT_PADDING,
      (wrapper.clientHeight / Math.max(box.length, 0.001)) * FIT_PADDING,
    );

    setView({
      pxPerMetre: clamp(scale, MIN_PX_PER_METRE, MAX_PX_PER_METRE),
      centre: { x: box.minX + box.width / 2, y: box.minY + box.length / 2 },
    });
  }, [ready, view, boundary]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver(() => {
      rendererRef.current?.resize(wrapper.clientWidth, wrapper.clientHeight);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [ready]);

  /*
   * The draw. `assetVersion` is a dependency for the reason it is in the raster cache key: a
   * garden drawn before its sprites arrived and after are different pictures, and without it the
   * plants would appear in patches as rasters happened to be rebuilt.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    const wrapper = wrapperRef.current;
    if (!renderer || !wrapper || !view || boundary.length < 3) return;

    /*
     * Deferred rather than drawn in the effect body, so a draw failure is reported from an async
     * continuation instead of cascading a render. It also coalesces a burst of store updates —
     * dragging the time slider fires many — into one frame.
     */
    const frame = requestAnimationFrame(() => {
      try {
        const scene = buildRenderScene(
          { boundary, house: boundaryDraft.house, elements, site: boundaryDraft },
          { view: 'visualise', maturity },
        );
        /*
         * One measurement, both layers. Measured here rather than inside either of them: the
         * WebGL canvas and the 2D overlay must agree about where the middle of the view is, and
         * the only way to guarantee that is to give them the same number.
         */
        const size: ViewSize = { width: wrapper.clientWidth, height: wrapper.clientHeight };
        if (size.width === 0 || size.height === 0) return;

        renderer.render(scene, view, size);
        drawOverlayCanvas(overlayRef.current, scene, boundaryDraft, view, size);
      } catch {
        setFailed(true);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [boundary, boundaryDraft, elements, maturity, view, assetVersion, ready]);

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    setView((current) => {
      if (!current) return current;
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      return {
        ...current,
        pxPerMetre: clamp(current.pxPerMetre * factor, MIN_PX_PER_METRE, MAX_PX_PER_METRE),
      };
    });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!view) return;
      (event.target as Element).setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, centre: view.centre };
    },
    [view],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    setView((current) => {
      if (!current) return current;
      return {
        ...current,
        centre: {
          x: start.centre.x - (event.clientX - start.x) / current.pxPerMetre,
          y: start.centre.y - (event.clientY - start.y) / current.pxPerMetre,
        },
      };
    });
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <div
      ref={wrapperRef}
      data-testid="visualise-canvas"
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-garden-sage/40"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/*
        The objects, the house and the fence, on a 2D canvas over the WebGL one.

        Not a compromise but a division of labour: WebGL earns its place on the ground and on the
        thousands of plant sprites, where batching is the whole game. It earns nothing on the
        twenty-odd pergolas, benches and trees — and writing those a second time in WebGL would
        mean two sets of drawing rules that can disagree, which is the drift `buildRenderScene`
        exists to stop. Both canvases draw from one scene and one transform.
      */}
      <canvas
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {failed ? (
        <p
          data-testid="visualise-failed"
          className="absolute inset-0 flex items-center justify-center text-xs text-garden-muted"
        >
          This view needs WebGL, which this browser has not made available. The Plan tab and the PNG
          download still work.
        </p>
      ) : null}
    </div>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PatternCanvas;
};

function drawOverlayCanvas(
  canvas: HTMLCanvasElement | null,
  scene: Parameters<typeof drawOverlay>[1],
  site: Parameters<typeof drawOverlay>[2],
  view: ViewTransform,
  { width, height }: ViewSize,
): void {
  if (!canvas) return;

  const ratio = Math.min(2, window.devicePixelRatio || 1);

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const context = canvas.getContext('2d');
  if (!context) return;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  /*
   * The world point the overlay's (0, 0) is, so it lines up with the WebGL canvas exactly. Both
   * are placing `view.centre` in the middle of the same box, so the origin is one subtraction.
   */
  const rasterOrigin = {
    x: view.centre.x - width / 2 / view.pxPerMetre,
    y: view.centre.y - height / 2 / view.pxPerMetre,
  };

  drawOverlay(
    context as unknown as PlanContext,
    scene,
    site,
    { pxPerMetre: view.pxPerMetre, light: scene.light, assets: getAssetVariants, makeCanvas },
    rasterOrigin,
  );
}
