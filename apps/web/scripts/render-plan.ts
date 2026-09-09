import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  boundaryPolygon,
  boundingBox,
  lightDirection,
  readPlanDocument,
  shadowCast,
  type PlanDocument,
  type Point,
} from '@garden-studio/schema';
import { nodeAssetLoader } from '../src/lib/materials/assets/node-loader';
import {
  assetVersion,
  getAssetVariants,
  preloadAssets,
} from '../src/lib/materials/assets/registry';
import { drawPlan, type PlanContext, type PlanScene } from '../src/lib/materials/render-plan';
import type { BuildOptions } from '../src/lib/render/build-scene';
import type { MakeCanvas, PatternCanvas } from '../src/lib/materials/render-surface-pattern';
import { preparePreviewDir } from './preview-dir';

/**
 * Renders whole plans to PNGs so they can be looked at.
 *
 * `render:material` judges one material against another; this judges the garden. It draws the
 * fixtures captured by `capture:fixtures` — real generator output — through the same composer the
 * concept cards and the PNG export use, at the editor's default zoom and at a close one, and keeps
 * the previous run in `before/` because tuning is a comparison exercise.
 *
 *     pnpm --filter @garden-studio/web render:plan
 *
 * Nothing here asserts anything and it needs no database. The fixtures are files.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// Its own directory, not a subfolder of `.material-preview/`: `render:material` clears that one.
const OUT_DIR = join(HERE, '..', '.plan-preview');
const FIXTURES = join(HERE, 'fixtures');
const PUBLIC_ASSETS = join(HERE, '..', 'public', 'assets');

const FIXTURE_NAMES = ['suburban', 'l-shape', 'courtyard', 'reference'] as const;

/** The editor's default zoom, and one close enough to read the slabs. */
const ZOOMS: [number, string][] = [
  [26, 'plan'],
  [64, 'close'],
];

const MARGIN_METRES = 1;
const PAPER = '#f4f2ed';

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

function loadFixture(name: string): PlanDocument {
  const file = join(FIXTURES, `${name}.plan.json`);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm capture:fixtures\` with the API up first`);
  }

  return readPlanDocument(JSON.parse(readFileSync(file, 'utf8')));
}

function sceneOf(document: PlanDocument): PlanScene {
  return {
    boundary: boundaryPolygon(document.site),
    house: document.site.house,
    elements: document.layout.elements,
    site: document.site,
  };
}

/** One plan at one zoom, with a margin of paper round it. */
function renderPlan(
  scene: PlanScene,
  pxPerMetre: number,
  options: BuildOptions = {},
): Buffer {
  const box = boundingBox(scene.boundary);
  const width = Math.ceil((box.width + MARGIN_METRES * 2) * pxPerMetre);
  const height = Math.ceil((box.length + MARGIN_METRES * 2) * pxPerMetre);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  drawPlan(
    context as unknown as PlanContext,
    scene,
    {
      pxPerMetre,
      light: lightDirection(scene.site) ?? undefined,
      makeCanvas,
      assets: getAssetVariants,
    },
    { x: box.minX - MARGIN_METRES, y: box.minY - MARGIN_METRES },
    options,
  );

  return canvas.toBuffer('image/png');
}

/**
 * A garden at four times of one day.
 *
 * The most informative sheet here, and it was found by accident: a throwaway script written to
 * check the shadow layer said far more than any single frame. The noon ratio is visibly
 * 1/tan(60 degrees) for this latitude, and the evening frame is the one where the house throws a
 * diagonal across the garden — which is the whole argument for the sun model. Four frames also
 * catch what one cannot: whether the shadows and the surface shading agree about where the light
 * is as it moves.
 */
function shadowHours(document: PlanDocument): Buffer {
  const px = 18;
  const pad = 10;
  const caption = 18;
  const cols = 2;
  const rows = 2;

  const base = sceneOf(document);
  if (!base.site.location) {
    throw new Error('the shadow-hours sheet needs a fixture with a location');
  }

  const box = boundingBox(base.boundary);
  const plotW = Math.ceil(box.width * px);
  const plotH = Math.ceil(box.length * px);

  const width = cols * plotW + (cols + 1) * pad;
  const height = rows * (plotH + caption) + (rows + 1) * pad;

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  const hours: [string, number][] = [
    ['09:00', 540],
    ['12:00', 720],
    ['16:00', 960],
    ['19:00', 1140],
  ];

  hours.forEach(([label, minutes], index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const ox = pad + col * (plotW + pad);
    const oy = pad + row * (plotH + caption + pad) + caption;

    const site = { ...base.site, sun: { ...base.site.sun, minutes } };
    const scene: PlanScene = { ...base, site };
    const cast = shadowCast(site);

    context.save();
    context.translate(ox, oy);
    drawPlan(
      context as unknown as PlanContext,
      scene,
      {
        pxPerMetre: px,
        light: lightDirection(site) ?? undefined,
        makeCanvas,
        assets: getAssetVariants,
      },
      { x: box.minX, y: box.minY },
    );
    context.restore();

    context.fillStyle = '#1a231c';
    context.font = 'bold 13px sans-serif';
    context.fillText(
      `${label}  ·  shadow ${cast ? `${cast.lengthPerMetre.toFixed(2)}x height` : 'none (sun down)'}`,
      ox,
      oy - 6,
    );
  });

  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  await preloadAssets(nodeAssetLoader(PUBLIC_ASSETS));
  console.log(`Assets ${assetVersion()}`);

  const beforeDir = preparePreviewDir(OUT_DIR);
  const written: string[] = [];

  const write = (name: string, png: Buffer) => {
    writeFileSync(join(OUT_DIR, `${name}.png`), png);
    written.push(name);
  };

  FIXTURE_NAMES.forEach((name, index) => {
    const document = loadFixture(name);
    const scene = sceneOf(document);
    const prefix = String(index + 1).padStart(2, '0');

    for (const [pxPerMetre, label] of ZOOMS) {
      write(`${prefix}-${name}-${label}`, renderPlan(scene, pxPerMetre));
      /*
       * The same garden with its planting lifted out of the beds' rasters and drawn as sprites
       * above them. Written beside the plan drawing on purpose: the two are only judgeable
       * against each other, and the question this sheet answers is whether the beds have stopped
       * reading as cut-outs.
       */
      write(
        `${prefix}-${name}-${label}-visualise`,
        renderPlan(scene, pxPerMetre, { view: 'visualise' }),
      );
    }
  });

  write('04-shadow-hours', shadowHours(loadFixture('suburban')));

  console.log(`Wrote ${written.length} PNGs to ${OUT_DIR}`);
  if (existsSync(beforeDir)) console.log(`Previous run kept in ${beforeDir} for comparison`);
  for (const name of written) console.log(`  ${name}.png`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

/** Kept for a reader checking the frame: the sheets draw in the plan's own metres, top-left up. */
export type { Point };
