'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildRenderScene } from '@/lib/render/build-scene';
import { QUALITY_FIXTURES, qualityScene, type QualityFixture } from '@/lib/render/quality-fixtures';
import { SceneRenderer } from '@/lib/render/pixi/renderer';
import { useAssetPreload, useAssetVersion } from '@/lib/materials/assets/use-assets';
import { drawCanvasScene } from '@/lib/render/canvas-compositor';
import type { Maturity } from '@/lib/render/scene';
import type { RendererVersion } from '@/lib/render/primitives';
import type { PlantingPreview } from '@/lib/render/plant-clusters';

const size = { width: 640, height: 760 };

export function RenderLab() {
  const [fixture, setFixture] = useState<QualityFixture>('target');
  const [scale, setScale] = useState(32);
  const [maturity, setMaturity] = useState<Maturity>('mature');
  const [minutes, setMinutes] = useState(900);
  const [version, setVersion] = useState<RendererVersion>('v2');
  const [fragments, setFragments] = useState(false);
  const [plantingPreview, setPlantingPreview] = useState<PlantingPreview>('hybrid');
  const [pan, setPan] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const gpuHost = useRef<HTMLDivElement>(null);
  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<SceneRenderer | null>(null);
  useAssetPreload();
  const assets = useAssetVersion();
  const source = useMemo(() => {
    const scene = qualityScene(fixture);
    return { ...scene, site: { ...scene.site, sun: { ...scene.site.sun, minutes } } };
  }, [fixture, minutes]);
  const scene = useMemo(() => buildRenderScene(source,
    { view: 'visualise', maturity, rendererVersion: version, depthFragments: fragments }), [source, maturity, version, fragments]);
  const view = useMemo(() => ({ pxPerMetre: scale, plantingPreview, centre: {
    x: scene.bounds.minX + scene.bounds.width / 2 + pan,
    y: scene.bounds.minY + scene.bounds.length / 2,
  } }), [scene.bounds, scale, pan, plantingPreview]);

  useEffect(() => {
    const host = gpuHost.current;
    if (!host) return;
    // Each mount owns its canvas, including StrictMode's asynchronous setup/cleanup.
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'lab-pixi';
    canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
    host.append(canvas);
    const instance = new SceneRenderer();
    let live = true;
    const lost = () => { if (live) setError('WebGL context lost'); };
    canvas.addEventListener('webglcontextlost', lost);
    void instance.mount(canvas, size.width, size.height).then(() => {
      if (!live) { instance.destroy(); return; }
      renderer.current = instance; setReady(true);
    }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    return () => {
      live = false; renderer.current = null;
      canvas.removeEventListener('webglcontextlost', lost);
      instance.destroy(); canvas.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready || !renderer.current || !cpuCanvas.current) return;
    try {
      renderer.current.render(scene, view, size);
      drawCanvasScene(cpuCanvas.current, scene, view, size);
    } catch (reason) { queueMicrotask(() => setError(String(reason))); }
  }, [ready, scene, view, scale, source, assets]);

  return <main className="p-4" data-testid="render-lab" data-ready={ready && assets !== 'none' && !assets.endsWith('-w1')} data-error={error}>
    <h1 className="text-lg font-semibold">Rendering quality lab</h1>
    <div className="my-3 flex flex-wrap gap-4">
      <label>Fixture <select aria-label="Fixture" value={fixture} onChange={(event) => setFixture(event.target.value as QualityFixture)}>
        {QUALITY_FIXTURES.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label>Renderer <select aria-label="Renderer" value={version} onChange={(event) => setVersion(event.target.value as RendererVersion)}>
        <option>v2</option><option>legacy</option>
      </select></label>
      <label>Maturity <select aria-label="Maturity" value={maturity} onChange={(event) => setMaturity(event.target.value as Maturity)}>
        <option>year-1</option><option>year-3</option><option>mature</option>
      </select></label>
      <label>Planting preview <select aria-label="Planting preview" value={plantingPreview} onChange={(event) => setPlantingPreview(event.target.value as PlantingPreview)}>
        <option value="hybrid">Hybrid LOD</option><option value="individual">Individual plants</option><option value="masses">Low-tier masses</option>
      </select></label>
      <label>Scale <input aria-label="Scale" type="number" value={scale} onChange={(event) => setScale(Math.max(4, Number(event.target.value)))} className="w-20" /></label>
      <label>Time <input aria-label="Time" type="number" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="w-20" /></label>
      <label><input aria-label="Depth fragments" type="checkbox" checked={fragments} onChange={(event) => setFragments(event.target.checked)} /> Depth fragments</label>
      <button onClick={() => setPan((value) => value + 0.05)}>Pan right</button>
      <button onClick={() => setPan(0)}>Reset pan</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="flex gap-4">
      <figure><figcaption>Pixi</figcaption><div ref={gpuHost} style={size} /></figure>
      <figure><figcaption>Canvas2D reference</figcaption><canvas ref={cpuCanvas} data-testid="lab-canvas" style={size} /></figure>
    </div>
  </main>;
}
