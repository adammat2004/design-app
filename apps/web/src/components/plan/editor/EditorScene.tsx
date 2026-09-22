'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteSection } from '@garden-studio/schema';
import type { CanvasTransform } from '@/lib/canvas-transform';
import { useAssetVersion } from '@/lib/materials/assets/use-assets';
import { drawBrowserOverlay } from '@/lib/render/draw-browser-overlay';
import { SceneRenderer } from '@/lib/render/pixi/renderer';
import { gradeCss } from '@/lib/materials/grade';
import { GradeFilter } from './GradeFilter';
import type { RenderScene } from '@/lib/render/scene';

/** Paint only. All pointer events and the only camera belong to EditorCanvas/Konva. */
export function EditorScene({ scene, site, transform, onReady }: {
  scene: RenderScene; site: SiteSection; transform: CanvasTransform;
  onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<SceneRenderer | null>(null);
  const [mounted, setMounted] = useState(false);
  const assets = useAssetVersion();
  const initialSize = useRef(transform);

  useEffect(() => {
    const wrapper = host.current;
    if (!wrapper) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    wrapper.prepend(canvas);
    const instance = new SceneRenderer();
    let live = true;
    void instance.mount(canvas, initialSize.current.stageWidth, initialSize.current.stageHeight)
      .then(() => {
        if (!live) { instance.destroy(); return; }
        renderer.current = instance;
        setMounted(true);
      }).catch(() => { if (live) onReady(false); });
    const lost = () => onReady(false);
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      live = false;
      renderer.current = null;
      canvas.removeEventListener('webglcontextlost', lost);
      instance.destroy();
      canvas.remove();
    };
  }, [onReady]);

  useLayoutEffect(() => {
    const instance = renderer.current;
    if (!mounted || !instance || transform.stageWidth === 0 || transform.stageHeight === 0) return;
    let live = true;
    try {
      const size = { width: transform.stageWidth, height: transform.stageHeight };
      const view = { pxPerMetre: transform.scale, centre: {
        x: (size.width / 2 - transform.offsetX) / transform.scale,
        y: (size.height / 2 - transform.offsetY) / transform.scale,
      } };
      instance.resize(size.width, size.height);
      instance.render(scene, view, size);
      drawBrowserOverlay(overlay.current, scene, site, view, size);
      queueMicrotask(() => { if (live) onReady(true); });
    } catch {
      queueMicrotask(() => { if (live) onReady(false); });
    }
    return () => { live = false; };
  }, [mounted, scene, site, transform, assets, onReady]);

  /*
   * `data-view` is the camera this scene was built to, exposed so a browser test can assert it.
   * The 2D Plan tab once built a *visualise* scene and drew the elevated library for a whole
   * commit while every unit test passed — because each guard one layer down was intact and the
   * fault was a caller asking for the wrong camera. Nothing below the call site can catch that,
   * so the call site's answer has to be visible from outside.
   *
   * `data-stack` is the corroborating half, and it took over from `data-plants` when the planting
   * rework made the 2D Plan draw instanced sprites too: a plan scene has plants now, so their
   * absence stopped being evidence of anything. What is still true of the plan camera and only of
   * it is that its stack holds **plants and nothing else** — `buildStack`, which is the whole of
   * the elevated drawing, is not called on that path — so the two counts are equal there and are
   * not in Visualise, where the objects, the house and the fence join them.
   */
  return <>
    <GradeFilter />
    <div ref={host} data-testid="editor-scene" data-plants={scene.plants.length}
      data-view={scene.view}
      data-stack={scene.stack.length}
      data-scale={transform.scale} data-offset-x={transform.offsetX} data-offset-y={transform.offsetY}
      aria-hidden className="pointer-events-none absolute inset-0"
      /*
       * The same grade the sheets and the download get, and for the same reason the Visualise
       * wrapper carries one: this div is the only element that contains **both** the Pixi canvas
       * and the 2D overlay, so it is the only place a single filter reaches all the design pixels.
       * As CSS rather than as arithmetic because this repaints on every frame of every drag, and
       * `getImageData` over the viewport per frame is a cost the download does not pay.
       *
       * The Konva chrome is a *sibling* in `EditorCanvas`, so handles, guides and the tape stay
       * ungraded — which is right: they are the interface, not the garden.
       */
      style={{ filter: gradeCss() }}>
      <canvas ref={overlay} className="absolute inset-0 h-full w-full" />
    </div>
  </>;
}
