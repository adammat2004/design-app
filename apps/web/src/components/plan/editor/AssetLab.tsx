'use client';

/* eslint-disable @next/next/no-img-element -- a dev page judging the raw files as served; next/image would re-encode the very pixels under review */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  elevatedFrame,
  type AssetFamily,
  type AssetGroup,
  type AssetId,
} from '@/lib/materials/assets/asset-spec';
import { ASSET_SPEC_VERSION } from '@/lib/materials/assets/asset-style';
import { ASSET_BASE_URL } from '@/lib/materials/assets/browser-loader';
import { catalogueVariants, type CatalogueEntry } from '@/lib/materials/assets/catalogue';
import { assetAnchor } from '@/lib/materials/assets/taxonomy';
import { useAssetPreload, useAssetVersion } from '@/lib/materials/assets/use-assets';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
} from '@/lib/materials/light';
import { VEGETATION_MAX_ROTATION } from '@/lib/materials/symbols/elevated';
import { buildRenderScene } from '@/lib/render/build-scene';
import { drawCanvasScene } from '@/lib/render/canvas-compositor';
import type { PlantingPreview } from '@/lib/render/plant-clusters';
import { QUALITY_FIXTURES, qualityScene, type QualityFixture } from '@/lib/render/quality-fixtures';
import type { Maturity } from '@/lib/render/scene';

/**
 * The asset comparison lab.
 *
 * The question this page exists to answer is not "does this tree look good" but **"do thirty
 * different assets look like they belong in the same garden"** — so every panel here draws assets
 * beside each other, at one scale, on one ground, with the renderer's own placement arithmetic
 * (`elevatedFrame`, `assetAnchor`, the contact-shadow constants) rather than a fit of its own. What
 * you judge here is what the plan draws.
 *
 * Old against new is a second library root: `public/assets-v1/` is a gitignored copy taken before
 * the first regeneration (`cp -R public/assets public/assets-v1`), and because a file's path is
 * stable across regeneration the same catalogue entry names the old picture under one root and
 * the new under the other. No catalogue field, no registry change; a 404 means "no v1".
 */

const ROOTS = { current: ASSET_BASE_URL, v1: '/assets-v1/' } as const;
type Root = keyof typeof ROOTS;

const GROUPS: readonly AssetGroup[] = [
  'vegetation',
  'furniture',
  'feature',
  'structure',
  'surface',
  'architectural',
  'effect',
];

/** The grounds a sprite is judged on. Every one is a real texture family, tiled at its own size. */
const GROUNDS: readonly AssetId[] = [
  'tex-standard-turf',
  'tex-decorative-gravel',
  'tex-bark-mulch',
  'tex-soil',
  'tex-slate-chippings',
];
type Ground = AssetId | 'checker' | 'light' | 'dark';

const SCALE_LADDER = [8, 16, 32, 64, 200];

/* ---------------------------------------------------------------- images */

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** One decode per URL for the life of the page; a missing file resolves to `null`, never throws. */
function loadLabImage(url: string): Promise<HTMLImageElement | null> {
  let pending = images.get(url);
  if (!pending) {
    pending = (async () => {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
        return image;
      } catch {
        return null;
      }
    })();
    images.set(url, pending);
  }
  return pending;
}

/** What has decoded so far, keyed by URL. Module-level, like `images`: one library, one page. */
const resolved = new Map<string, HTMLImageElement | null>();

/**
 * Resolves the URLs it is given and re-renders the caller once they have all settled.
 *
 * Returns a version beside the map, and a drawing effect has to depend on the version: the map is
 * one object for the life of the page, so its identity never changes and an effect keyed on it
 * alone draws once, before anything has decoded, and never again. Found on the first screenshot.
 */
function useLabImages(urls: readonly string[]): {
  images: Map<string, HTMLImageElement | null>;
  version: number;
} {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const pending = urls.filter((url) => !resolved.has(url));
    if (pending.length === 0) return;
    void Promise.all(
      pending.map(async (url) => {
        resolved.set(url, await loadLabImage(url));
      }),
    ).then(() => {
      if (live) setVersion((tick) => tick + 1);
    });
    return () => {
      live = false;
    };
  }, [urls]);
  return { images: resolved, version };
}

/* ---------------------------------------------------------------- drawing */

interface LineupItem {
  id: AssetId;
  entry: CatalogueEntry;
  rotation: number;
  label: string;
}

function frameOf(family: AssetFamily): { w: number; h: number } {
  return family.camera === 'elevated' && family.kind === 'sprite'
    ? elevatedFrame(family)
    : family.metres;
}

function fillGround(
  context: CanvasRenderingContext2D,
  ground: Ground,
  tile: HTMLImageElement | null,
  pxPerMetre: number,
  width: number,
  height: number,
): void {
  if (ground === 'checker') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#d9dde0';
    for (let y = 0; y < height; y += 16) {
      for (let x = (y / 16) % 2 === 0 ? 0 : 16; x < width; x += 32) context.fillRect(x, y, 16, 16);
    }
    return;
  }
  if (ground === 'light' || ground === 'dark' || !tile) {
    context.fillStyle = ground === 'dark' ? '#2a2f2c' : '#f4f6f3';
    context.fillRect(0, 0, width, height);
    return;
  }
  const family: AssetFamily = ASSET_FAMILIES[ground];
  const pattern = context.createPattern(tile, 'repeat');
  if (!pattern) return;
  const scale = (family.metres.w * pxPerMetre) / tile.width;
  pattern.setTransform(new DOMMatrix().scale(scale));
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
}

/**
 * One asset at one scale on one ground point, placed exactly as the renderer places it.
 *
 * `ground` is the centre of the footprint in canvas pixels. A plan sprite is centred on it and
 * spans its `metres`; an elevated sprite's frame hangs from its anchor so the bottom band of the
 * image is the footprint; both turn about the same point. The contact shadow is the real
 * `fx-soft-shadow` file at the renderer's own scale, alpha and offset, pushed down-right as the
 * default plan light would.
 */
function drawFamily(
  context: CanvasRenderingContext2D,
  id: AssetId,
  image: HTMLImageElement,
  shadow: HTMLImageElement | null,
  ground: { x: number; y: number },
  pxPerMetre: number,
  rotation: number,
): void {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const frame = frameOf(family);
  const anchor = assetAnchor(id);
  const width = frame.w * pxPerMetre;
  const height = frame.h * pxPerMetre;

  if (family.kind === 'sprite' && shadow && family.taxon.group !== 'effect') {
    const reach =
      (Math.max(family.metres.w, family.metres.h) * pxPerMetre * CONTACT_SHADOW_SCALE) / 2;
    const push = reach * CONTACT_SHADOW_OFFSET_RATIO * Math.SQRT1_2;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    context.drawImage(
      shadow,
      ground.x - reach + push,
      ground.y - reach + push,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  context.save();
  context.translate(ground.x, ground.y);
  context.rotate(rotation);
  context.drawImage(image, -anchor.x * width, -anchor.y * height, width, height);
  context.restore();
}

function drawFootprint(
  context: CanvasRenderingContext2D,
  family: AssetFamily,
  ground: { x: number; y: number },
  pxPerMetre: number,
): void {
  context.strokeStyle = 'rgba(194, 82, 74, 0.7)';
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.strokeRect(
    ground.x - (family.metres.w * pxPerMetre) / 2,
    ground.y - (family.metres.h * pxPerMetre) / 2,
    family.metres.w * pxPerMetre,
    family.metres.h * pxPerMetre,
  );
  context.setLineDash([]);
}

/**
 * Several assets on one canvas at one scale, flowed into rows.
 *
 * One scale for the whole canvas, deliberately: fitting each asset to its own cell would make every
 * one of them look correctly sized by construction, and the point of a lineup is to see that a
 * bench is the size of a bench next to a shrub the size of a shrub.
 */
function Lineup({
  items,
  pxPerMetre,
  ground,
  root,
  footprints,
  width = 1180,
}: {
  items: LineupItem[];
  pxPerMetre: number;
  ground: Ground;
  root: Root;
  footprints: boolean;
  width?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useMemo(() => {
    const list = items.map((item) => `${ROOTS[root]}${item.entry.file}`);
    list.push(`${ROOTS.current}plan/sprites/fx-soft-shadow-1.webp`);
    if (ground in ASSET_FAMILIES) {
      const [tile] = catalogueVariants(ground as AssetId);
      if (tile) list.push(`${ROOTS.current}${tile.file}`);
    }
    return list;
  }, [items, root, ground]);
  const { images: loaded, version: loadedVersion } = useLabImages(urls);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const pad = 16;
    const cells = items.map((item) => {
      const frame = frameOf(ASSET_FAMILIES[item.id]);
      return {
        item,
        w: Math.max(frame.w * pxPerMetre, 72) + pad,
        h: frame.h * pxPerMetre + 36 + pad,
      };
    });
    const placed: { cell: (typeof cells)[number]; x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const cell of cells) {
      if (x + cell.w > width && x > 0) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      placed.push({ cell, x, y });
      x += cell.w;
      rowHeight = Math.max(rowHeight, cell.h);
    }
    const height = Math.max(120, y + rowHeight + 8);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const tile = ground in ASSET_FAMILIES ? (loaded.get(urls[urls.length - 1]!) ?? null) : null;
    fillGround(context, ground, tile, pxPerMetre, width, height);
    const shadow = loaded.get(`${ROOTS.current}plan/sprites/fx-soft-shadow-1.webp`) ?? null;

    for (const { cell, x: left, y: top } of placed) {
      const family: AssetFamily = ASSET_FAMILIES[cell.item.id];
      const frame = frameOf(family);
      const anchor = assetAnchor(cell.item.id);
      const at = {
        x: left + cell.w / 2,
        y: top + pad / 2 + anchor.y * frame.h * pxPerMetre,
      };
      const image = loaded.get(`${ROOTS[root]}${cell.item.entry.file}`);
      if (footprints && family.kind === 'sprite') drawFootprint(context, family, at, pxPerMetre);
      if (image)
        drawFamily(context, cell.item.id, image, shadow, at, pxPerMetre, cell.item.rotation);
      else {
        context.fillStyle = '#c2524a';
        context.font = '11px sans-serif';
        context.fillText(
          loaded.has(`${ROOTS[root]}${cell.item.entry.file}`) ? 'no file' : '…',
          at.x - 14,
          at.y,
        );
      }
      context.fillStyle = ground === 'dark' ? '#e6e9e5' : '#243d31';
      context.font = '10px sans-serif';
      context.fillText(cell.item.label, left + 6, top + cell.h - 10, cell.w - 12);
    }
  }, [items, pxPerMetre, ground, root, footprints, width, loaded, loadedVersion, urls]);

  return <canvas ref={canvas} className="max-w-full rounded border border-neutral-200" />;
}

/* ---------------------------------------------------------------- the scene */

const SCENE_SIZE = { width: 640, height: 640 };

function ScenePanel() {
  const [fixture, setFixture] = useState<QualityFixture>('dense');
  const [view, setView] = useState<'plan' | 'visualise'>('visualise');
  const [maturity, setMaturity] = useState<Maturity>('mature');
  const [scale, setScale] = useState(32);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const assets = useAssetVersion();
  const scene = useMemo(
    () => buildRenderScene(qualityScene(fixture), { view, maturity, rendererVersion: 'v2' }),
    [fixture, view, maturity],
  );
  useEffect(() => {
    if (!canvas.current) return;
    const plantingPreview: PlantingPreview = 'hybrid';
    try {
      drawCanvasScene(
        canvas.current,
        scene,
        {
          pxPerMetre: scale,
          plantingPreview,
          centre: {
            x: scene.bounds.minX + scene.bounds.width / 2,
            y: scene.bounds.minY + scene.bounds.length / 2,
          },
        },
        SCENE_SIZE,
      );
      queueMicrotask(() => setError(''));
    } catch (reason) {
      queueMicrotask(() => setError(String(reason)));
    }
  }, [scene, scale, assets]);

  return (
    <section className="my-6">
      <h2 className="text-base font-semibold">A garden, drawn by the renderer</h2>
      <p className="text-sm text-neutral-600">
        The same composer the concept cards and the export use, so this is the context every asset
        above actually lands in. Compare against the sheets in <code>.plan-preview-baseline/</code>{' '}
        for the previous library.
      </p>
      <div className="my-2 flex flex-wrap gap-4 text-sm">
        <label>
          Fixture{' '}
          <select
            aria-label="Scene fixture"
            value={fixture}
            onChange={(event) => setFixture(event.target.value as QualityFixture)}
          >
            {QUALITY_FIXTURES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          View{' '}
          <select
            aria-label="Scene view"
            value={view}
            onChange={(event) => setView(event.target.value as 'plan' | 'visualise')}
          >
            <option>plan</option>
            <option>visualise</option>
          </select>
        </label>
        <label>
          Maturity{' '}
          <select
            aria-label="Scene maturity"
            value={maturity}
            onChange={(event) => setMaturity(event.target.value as Maturity)}
          >
            <option>year-1</option>
            <option>year-3</option>
            <option>mature</option>
          </select>
        </label>
        <label>
          px/m{' '}
          <input
            aria-label="Scene scale"
            type="number"
            className="w-20"
            value={scale}
            onChange={(event) => setScale(Math.max(4, Number(event.target.value)))}
          />
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <canvas
        ref={canvas}
        data-testid="asset-lab-scene"
        style={SCENE_SIZE}
        className="rounded border border-neutral-200"
      />
    </section>
  );
}

/* ---------------------------------------------------------------- the page */

function recordOf(entry: CatalogueEntry): string {
  if (entry.generation) {
    return `${entry.generation.model} · ${entry.generation.quality} · spec ${entry.generation.specVersion}`;
  }
  if (entry.provenance) return `${entry.provenance.model} · unversioned`;
  return 'no record';
}

export function AssetLab() {
  useAssetPreload();
  const assets = useAssetVersion();
  const [group, setGroup] = useState<AssetGroup | 'all'>('all');
  const [camera, setCamera] = useState<'all' | 'plan' | 'elevated'>('all');
  const [kind, setKind] = useState<'all' | 'sprite' | 'texture' | 'face'>('all');
  const [search, setSearch] = useState('');
  const [compare, setCompare] = useState(false);
  const [root, setRoot] = useState<Root>('current');
  const [ground, setGround] = useState<Ground>('tex-standard-turf');
  const [lineupScale, setLineupScale] = useState(48);
  const [allVariants, setAllVariants] = useState(false);
  const [footprints, setFootprints] = useState(true);
  const [selected, setSelected] = useState<AssetId | null>(null);

  const families = useMemo(
    () =>
      ASSET_IDS.filter((id) => {
        const family: AssetFamily = ASSET_FAMILIES[id];
        if (group !== 'all' && family.taxon.group !== group) return false;
        if (camera !== 'all' && (family.camera ?? 'plan') !== camera) return false;
        if (kind !== 'all' && family.kind !== kind) return false;
        if (search) {
          const haystack = `${id} ${family.taxon.type} ${(family.taxon.tags ?? []).join(' ')}`;
          if (!haystack.toLowerCase().includes(search.toLowerCase())) return false;
        }
        return true;
      }),
    [group, camera, kind, search],
  );

  const lineup = useMemo<LineupItem[]>(
    () =>
      families.flatMap((id) => {
        const variants = catalogueVariants(id);
        const shown = allVariants ? variants : variants.slice(0, 1);
        return shown.map((entry) => ({
          id,
          entry,
          rotation: 0,
          label: allVariants ? `${id} · ${entry.variant}` : id,
        }));
      }),
    [families, allVariants],
  );

  const detail = useMemo(() => {
    if (!selected) return null;
    const family: AssetFamily = ASSET_FAMILIES[selected];
    const variants = catalogueVariants(selected);
    const first = variants[0];
    if (!first) return { family, variants, ladder: [], turns: [], all: [] };
    const elevated = family.camera === 'elevated' && family.kind === 'sprite';
    const angles =
      elevated && family.taxon.group === 'vegetation'
        ? [-VEGETATION_MAX_ROTATION, 0, VEGETATION_MAX_ROTATION]
        : family.kind === 'sprite'
          ? [0, Math.PI / 4, Math.PI / 2, Math.PI]
          : [0];
    return {
      family,
      variants,
      ladder: SCALE_LADDER.map((scale) => ({
        scale,
        item: { id: selected, entry: first, rotation: 0, label: `${scale} px/m` },
      })),
      turns: angles.map((angle) => ({
        id: selected,
        entry: first,
        rotation: angle,
        label: `${Math.round((angle * 180) / Math.PI)}°`,
      })),
      all: variants.map((entry) => ({
        id: selected,
        entry,
        rotation: 0,
        label: `variant ${entry.variant}`,
      })),
    };
  }, [selected]);

  return (
    <main
      className="p-4"
      data-testid="asset-lab"
      data-ready={assets !== 'none' && !assets.endsWith('-w1')}
    >
      <h1 className="text-lg font-semibold">Asset library lab</h1>
      <p className="text-sm text-neutral-600">
        {ASSET_IDS.length} families · specification {ASSET_SPEC_VERSION} · library {assets}
      </p>

      <div className="my-3 flex flex-wrap gap-4 text-sm">
        <label>
          Group{' '}
          <select
            aria-label="Group"
            value={group}
            onChange={(event) => setGroup(event.target.value as AssetGroup | 'all')}
          >
            <option value="all">all</option>
            {GROUPS.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Camera{' '}
          <select
            aria-label="Camera"
            value={camera}
            onChange={(event) => setCamera(event.target.value as typeof camera)}
          >
            <option value="all">all</option>
            <option>plan</option>
            <option>elevated</option>
          </select>
        </label>
        <label>
          Kind{' '}
          <select
            aria-label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="all">all</option>
            <option>sprite</option>
            <option>texture</option>
            <option>face</option>
          </select>
        </label>
        <label>
          Search{' '}
          <input
            aria-label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded border px-1"
          />
        </label>
        <label>
          Ground{' '}
          <select
            aria-label="Ground"
            value={ground}
            onChange={(event) => setGround(event.target.value as Ground)}
          >
            {GROUNDS.map((id) => (
              <option key={id}>{id}</option>
            ))}
            <option>checker</option>
            <option>light</option>
            <option>dark</option>
          </select>
        </label>
        <label>
          Library{' '}
          <select
            aria-label="Library"
            value={root}
            onChange={(event) => setRoot(event.target.value as Root)}
          >
            <option value="current">current</option>
            <option value="v1">v1 snapshot</option>
          </select>
        </label>
        <label>
          <input
            aria-label="Compare with v1"
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />{' '}
          cards show v1 beside current
        </label>
      </div>

      {/* ---- the lineup: the test the whole specification exists to pass ---- */}
      <section className="my-6">
        <h2 className="text-base font-semibold">Lineup — do these belong in one garden?</h2>
        <div className="my-2 flex flex-wrap gap-4 text-sm">
          <label>
            px/m{' '}
            <input
              aria-label="Lineup scale"
              type="number"
              className="w-20"
              value={lineupScale}
              onChange={(event) => setLineupScale(Math.max(4, Number(event.target.value)))}
            />
          </label>
          <label>
            <input
              aria-label="All variants"
              type="checkbox"
              checked={allVariants}
              onChange={(event) => setAllVariants(event.target.checked)}
            />{' '}
            every variant
          </label>
          <label>
            <input
              aria-label="Footprints"
              type="checkbox"
              checked={footprints}
              onChange={(event) => setFootprints(event.target.checked)}
            />{' '}
            footprints
          </label>
          <span className="text-neutral-500">
            {lineup.length} shown, drawn from the {root} library
          </span>
        </div>
        <Lineup
          items={lineup}
          pxPerMetre={lineupScale}
          ground={ground}
          root={root}
          footprints={footprints}
        />
      </section>

      {/* ---- the detail: one family at every scale, turned, and every variant ---- */}
      {detail ? (
        <section className="my-6" data-testid="asset-lab-detail">
          <h2 className="text-base font-semibold">
            {selected} · {detail.family.taxon.group}/{detail.family.taxon.type} ·{' '}
            {detail.family.metres.w}×{detail.family.metres.h} m
            {detail.family.heightMetres ? ` · ${detail.family.heightMetres} m tall` : ''}
          </h2>
          <p className="text-sm text-neutral-600">{detail.family.subject}</p>
          {detail.family.variantSubjects ? (
            <p className="text-sm text-neutral-500">
              Variants: {detail.family.variantSubjects.join(' · ')}
            </p>
          ) : null}
          {detail.variants.length === 0 ? (
            <p className="text-sm text-red-700">Not generated yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-medium">Scale ladder</h3>
                {detail.ladder.map(({ scale, item }) => (
                  <div key={scale} className="my-1 inline-block align-top">
                    <Lineup
                      items={[item]}
                      pxPerMetre={scale}
                      ground={ground}
                      root={root}
                      footprints={footprints}
                      width={Math.max(120, frameOf(detail.family).w * scale + 40)}
                    />
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium">Rotation</h3>
                <Lineup
                  items={detail.turns}
                  pxPerMetre={64}
                  ground={ground}
                  root={root}
                  footprints={footprints}
                  width={720}
                />
              </div>
              <div>
                <h3 className="text-sm font-medium">Every variant</h3>
                <Lineup
                  items={detail.all}
                  pxPerMetre={64}
                  ground={ground}
                  root={root}
                  footprints={footprints}
                />
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ---- the grid: every file, its record, and the old picture beside it ---- */}
      <section className="my-6">
        <h2 className="text-base font-semibold">Files</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {families.map((id) => {
            const family: AssetFamily = ASSET_FAMILIES[id];
            const variants = catalogueVariants(id);
            return (
              <div
                key={id}
                data-testid={`asset-card-${id}`}
                onClick={() => setSelected(id)}
                className={`cursor-pointer rounded border p-2 text-xs ${selected === id ? 'border-emerald-600' : 'border-neutral-200'}`}
              >
                <div className="font-medium">{id}</div>
                <div className="text-neutral-500">
                  {family.camera ?? 'plan'} · {family.kind} · {family.taxon.type}
                </div>
                {variants.length === 0 ? (
                  <div className="text-red-700">not generated ({family.variants} wanted)</div>
                ) : null}
                {variants.map((entry) => (
                  <div key={entry.variant} className="my-1">
                    <div className="flex gap-1">
                      <img
                        src={`${ROOTS.current}${entry.file}`}
                        alt={`${id} variant ${entry.variant}`}
                        className="h-20 w-20 object-contain"
                        style={{
                          background:
                            ground === 'dark'
                              ? '#2a2f2c'
                              : 'repeating-conic-gradient(#d9dde0 0 25%, #fff 0 50%) 0 0 / 16px 16px',
                        }}
                      />
                      {compare ? (
                        <img
                          src={`${ROOTS.v1}${entry.file}`}
                          alt={`${id} variant ${entry.variant}, previous library`}
                          className="h-20 w-20 object-contain opacity-90"
                          style={{
                            background:
                              'repeating-conic-gradient(#d9dde0 0 25%, #fff 0 50%) 0 0 / 16px 16px',
                          }}
                          onError={(event) => {
                            event.currentTarget.replaceWith(
                              Object.assign(document.createElement('span'), {
                                textContent: 'no v1',
                                className: 'text-neutral-400',
                              }),
                            );
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="text-neutral-500">
                      v{entry.variant} · <span style={{ color: entry.meanColour }}>■</span>{' '}
                      {recordOf(entry)}
                    </div>
                    {entry.processed?.defects.length ? (
                      <div className="text-red-700">{entry.processed.defects.join('; ')}</div>
                    ) : null}
                    {entry.processed?.warnings.length ? (
                      <div className="text-amber-700">{entry.processed.warnings.join('; ')}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <ScenePanel />
    </main>
  );
}
