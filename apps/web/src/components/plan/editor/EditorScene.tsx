'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteSection } from '@garden-studio/schema';
import type { CanvasTransform } from '@/lib/canvas-transform';
import { useAssetVersion } from '@/lib/materials/assets/use-assets';
import { drawBrowserOverlay } from '@/lib/render/draw-browser-overlay';
import { SceneRenderer } from '@/lib/render/pixi/renderer';
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
   */
  return <div ref={host} data-testid="editor-scene" data-plants={scene.plants.length}
    data-view={scene.view}
    data-scale={transform.scale} data-offset-x={transform.offsetX} data-offset-y={transform.offsetY}
    aria-hidden className="pointer-events-none absolute inset-0">
    <canvas ref={overlay} className="absolute inset-0 h-full w-full" />
  </div>;
}
