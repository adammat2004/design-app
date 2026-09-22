import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  boundaryPolygon,
  boundingBox,
  elementArea,
  elementOutline,
  isTreeSymbol,
  lightDirection,
  pointInPolygon,
  readPlanDocument,
  resolveSymbol,
  type PlanDocument,
  type Point,
} from '@garden-studio/schema';
import { buildRenderScene } from '../src/lib/render/build-scene';
import { nodeAssetLoader } from '../src/lib/materials/assets/node-loader';
import { assetVersion, preloadAssets, getAssetVariants } from '../src/lib/materials/assets/registry';
import catalogue from '../src/lib/materials/assets/catalogue.json';
import { drawPlan, type PlanContext, type PlanScene } from '../src/lib/materials/render-plan';
import type { MakeCanvas, PatternCanvas } from '../src/lib/materials/render-surface-pattern';

/**
 * How close the composed picture is to `target_design.png`, measured rather than argued.
 *
 *     pnpm --filter @garden-studio/web measure:render
 *
 * The design review that started this work measured our render at 0.347 saturation against the
 * target's 0.243 and concluded we are 44% over. **That comparison was not like-for-like**, and this
 * script exists because the repo already contains the control that makes it so.
 *
 * Two problems with the original number, both of which this script is built to avoid:
 *
 *   1. **It compared different gardens.** `target_design.png` was measured against the *suburban*
 *      and *l-shape* fixtures, which have different lawn shares. Mean saturation over a garden is
 *      partly a function of how much of it is grass, so an unknown slice of that 44% was
 *      composition rather than colour. `fixtures/target.plan.json` is `target_design.png` traced by
 *      hand — same garden, same layout — and it is reported first, as THE CONTROL.
 *
 *   2. **`target_design.png` is a screenshot of an application, not a picture of a garden.** It is
 *      1536 x 1024 and carries a top nav, a left palette of element cards and a right properties
 *      panel, all of them near-white. White is zero-saturation and high-luminance, so any crop that
 *      catches chrome pushes the measurement in exactly the direction the reported gap ran. So the
 *      target is sampled inside an explicit in-plot quadrilateral, and the script reports the
 *      near-white fraction of every region it measures so a bad region cannot pass unnoticed.
 *
 * Both sides are then measured the same way: only pixels *inside the plot*, ours by the real
 * boundary polygon, the target's by `TARGET_PLOT`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');
const PUBLIC_ASSETS = join(HERE, '..', 'public', 'assets');
const TARGET_IMAGE = join(REPO, 'target_design.png');

const PX_PER_METRE = 26;
const MARGIN_METRES = 1;
const PAPER = '#f4f2ed';

/**
 * The plot inside `target_design.png`, in image pixels.
 *
 * Read off the 1536 x 1024 screenshot and inset from the drawn fence so no page background creeps
 * in at the rotated corners. It is a quadrilateral rather than a rectangle because the plot is drawn
 * turned a few degrees; a bounding box would be about a fifth white page.
 *
 * Deliberately includes the house and the driveway. Our own measurement includes them too — the
 * question is whether the composed *picture* matches, and cropping the building out of one side and
 * not the other is the same mistake in a smaller coat.
 */
const TARGET_PLOT: Point[] = [
  { x: 372, y: 196 },
  { x: 1192, y: 158 },
  { x: 1248, y: 926 },
  { x: 350, y: 894 },
];

/** Anything this pale is page, panel or chrome rather than garden. Diagnostic only. */
const NEAR_WHITE = 0.93;

const makeCanvas: MakeCanvas = (width, height) =>
  createCanvas(width, height) as unknown as PatternCanvas;

interface Measurement {
  saturation: number;
  luminance: number;
  contrast: number;
  nearWhite: number;
  samples: number;
  /**
   * The mean of each channel, 0-1 — what a *warm* or *cool* picture differs from a neutral one by.
   *
   * Saturation, luminance and contrast between them cannot see colour temperature at all: a render
   * and its reference can match on all three and still be one blue and one golden, because every
   * one of those statistics is computed over channels that have already been collapsed. Warmth is
   * the balance *between* them, so it needs its own row, and adding a warm term to the grade
   * without one would be dialling rather than solving — which is the one thing `grade.ts` refuses.
   */
  channels: { r: number; g: number; b: number };
}

/**
 * Saturation is HSV `(max - min) / max`, luminance is Rec. 709 luma over 255, contrast is the
 * standard deviation of that luminance. Stated here because "saturation" names at least three
 * different quantities and a target number is meaningless without saying which.
 */
function measure(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean,
): Measurement {
  let saturation = 0;
  let luminance = 0;
  let nearWhite = 0;
  let samples = 0;
  const totals = { r: 0, g: 0, b: 0 };
  const lumas: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;

      const index = (y * width + x) * 4;
      if (data[index + 3]! < 128) continue;

      const r = data[index]!;
      const g = data[index + 1]!;
      const b = data[index + 2]!;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      saturation += max === 0 ? 0 : (max - min) / max;
      luminance += luma;
      totals.r += r;
      totals.g += g;
      totals.b += b;
      if (luma > NEAR_WHITE && max - min < 12) nearWhite += 1;
      lumas.push(luma);
      samples += 1;
    }
  }

  if (samples === 0)
    return {
      saturation: 0,
      luminance: 0,
      contrast: 0,
      nearWhite: 0,
      samples: 0,
      channels: { r: 0, g: 0, b: 0 },
    };

  const meanLuma = luminance / samples;
  const variance = lumas.reduce((sum, l) => sum + (l - meanLuma) ** 2, 0) / samples;

  return {
    saturation: saturation / samples,
    luminance: meanLuma,
    contrast: Math.sqrt(variance),
    nearWhite: nearWhite / samples,
    samples,
    channels: {
      r: totals.r / samples / 255,
      g: totals.g / samples / 255,
      b: totals.b / samples / 255,
    },
  };
}

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

/** Rendered in Visualise, with assets on — the palette question needs the photographs present. */
function measureFixture(name: string): Measurement {
  const scene = sceneOf(loadFixture(name));
  const box = boundingBox(scene.boundary);
  const width = Math.ceil((box.width + MARGIN_METRES * 2) * PX_PER_METRE);
  const height = Math.ceil((box.length + MARGIN_METRES * 2) * PX_PER_METRE);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  const origin = { x: box.minX - MARGIN_METRES, y: box.minY - MARGIN_METRES };

  drawPlan(
    context as unknown as PlanContext,
    scene,
    {
      pxPerMetre: PX_PER_METRE,
      light: lightDirection(scene.site) ?? undefined,
      makeCanvas,
      assets: getAssetVariants,
    },
    origin,
    { view: 'visualise' },
  );

  const image = context.getImageData(0, 0, width, height).data;

  // Inside the real boundary, so the paper margin never enters the number.
  return measure(image, width, height, (x, y) =>
    pointInPolygon(
      { x: origin.x + (x + 0.5) / PX_PER_METRE, y: origin.y + (y + 0.5) / PX_PER_METRE },
      scene.boundary,
    ),
  );
}

async function measureTarget(): Promise<Measurement> {
  const image = await loadImage(readFileSync(TARGET_IMAGE));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;

  return measure(data, image.width, image.height, (x, y) =>
    pointInPolygon({ x: x + 0.5, y: y + 0.5 }, TARGET_PLOT),
  );
}

/* ------------------------------------------------------------------- what the planting is ---- */

/**
 * The planting, measured as planting rather than as colour.
 *
 * Everything above this line is a colour statistic, and colour is the one thing about our beds
 * that was never the problem: a bed can match the reference's saturation exactly and still read as
 * a carpet of dots, because what separates the two pictures is *how many plants there are, how big
 * they are, and how much bare ground shows between them*. None of that is visible to a mean.
 *
 * So these numbers come from the scene rather than from the pixels — `RenderPlant` already carries
 * a position and a spread, which is precisely the question — and they are reported per fixture so
 * a change to a density constant can be judged by what it did rather than by how it looked on the
 * one sheet somebody happened to open.
 *
 * What a real mixed border is, for the reader deciding whether a number is good: about 5 to 7
 * herbaceous plants per square metre with 0.5 to 1.5 shrubs among them, covering essentially all
 * of the soil by the third year. Bare ground in a finished planting scheme is mulch you can see
 * *between* young plants, not a background the planting sits on.
 */
interface PlantingMeasurement {
  plants: number;
  bedArea: number;
  perSquareMetre: number;
  meanSpread: number;
  /** Share of bed area under some foliage, sampled. The complement is bare ground. */
  cover: number;
  /** Share of the plants whose drawn spread is under 0.5 m — the "dots". */
  smallShare: number;
  /** Share of the whole plot under a tree canopy. */
  canopy: number;
}

/** 10 cm, which is finer than any plant we draw and cheap enough over a whole plot. */
const SAMPLE_METRES = 0.1;

function measurePlanting(document: PlanDocument): PlantingMeasurement {
  const scene = sceneOf(document);
  /*
   * Visualise, because that is where planting exists as things. In the plan view the same plants
   * are painted into each bed's raster and there is nothing to count — which is itself one of the
   * findings this measurement exists to make checkable.
   */
  const built = buildRenderScene(scene, { view: 'visualise' });

  const beds = scene.elements.filter(
    (element) => element.category === 'planting-bed' && element.shape.kind !== 'point',
  );
  const bedArea = beds.reduce((total, bed) => total + elementArea(bed), 0);

  const spreads = built.plants.map((plant) => plant.spread);
  const meanSpread = spreads.length
    ? spreads.reduce((total, spread) => total + spread, 0) / spreads.length
    : 0;

  /*
   * Cover is sampled rather than summed, and that is the whole point of doing it this way: adding
   * up πr² double-counts every overlap, and overlap is exactly what a dense border is made of. A
   * grid point is covered if it is inside any plant's own disc.
   */
  const covered = sampleCover(
    beds.map((bed) => elementOutline(bed)),
    built.plants.map((plant) => ({ at: plant.at, radius: plant.spread / 2 })),
  );

  const trees = scene.elements.filter((element) => {
    const symbol = resolveSymbol(element);
    return element.shape.kind === 'point' && symbol !== null && isTreeSymbol(symbol);
  });
  const canopy = sampleCover(
    [scene.boundary],
    trees.map((tree) => ({
      at: (tree.shape as { at: Point }).at,
      radius: (tree.shape as { radius: number }).radius,
    })),
  );

  return {
    plants: built.plants.length,
    bedArea,
    perSquareMetre: bedArea > 0 ? built.plants.length / bedArea : 0,
    meanSpread,
    cover: covered,
    smallShare: spreads.length ? spreads.filter((s) => s < 0.5).length / spreads.length : 0,
    canopy,
  };
}

/** Share of the area inside `regions` that falls within one of the discs. */
function sampleCover(regions: Point[][], discs: { at: Point; radius: number }[]): number {
  const rings = regions.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return 0;

  const box = boundingBox(rings.flat());
  let inside = 0;
  let covered = 0;

  for (let y = box.minY; y < box.minY + box.length; y += SAMPLE_METRES) {
    for (let x = box.minX; x < box.minX + box.width; x += SAMPLE_METRES) {
      const point = { x: x + SAMPLE_METRES / 2, y: y + SAMPLE_METRES / 2 };
      if (!rings.some((ring) => pointInPolygon(point, ring))) continue;
      inside += 1;
      if (
        discs.some(
          (disc) =>
            (point.x - disc.at.x) ** 2 + (point.y - disc.at.y) ** 2 <= disc.radius * disc.radius,
        )
      ) {
        covered += 1;
      }
    }
  }

  return inside === 0 ? 0 : covered / inside;
}

/* ---------------------------------------------------------------- the asset palette probe ---- */

function hexSaturation(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  return max === 0 ? 0 : (max - min) / max;
}

function hexLuminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);

  return (
    (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255
  );
}

/**
 * The runtime-versus-baked question, asked of the files rather than the frame.
 *
 * If the catalogue's own mean colours are already far more saturated than the reference, then a
 * runtime grade is compensating every frame for something that could be corrected once, offline,
 * in `tools/assets --reprocess` — and the baked answer would improve 2D Plan, the concept cards and
 * the export as well, which a Visualise-only grade cannot.
 */
function measurePalette(): void {
  const entries = (catalogue as { assets: { id: string; meanColour?: string }[] }).assets;

  const groups = new Map<string, number[]>();
  for (const entry of entries) {
    if (!entry.meanColour) continue;
    const group = entry.id.split('-')[0] ?? 'other';
    const list = groups.get(group) ?? [];
    list.push(hexSaturation(entry.meanColour));
    groups.set(group, list);
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const all = [...groups.values()].flat();

  console.log('\nAsset palette — mean colour saturation per family group');
  console.log('  group          n     saturation');
  for (const [group, values] of [...groups.entries()].sort((a, b) => mean(b[1]) - mean(a[1]))) {
    console.log(
      `  ${group.padEnd(13)} ${String(values.length).padStart(3)}   ${mean(values).toFixed(3)}`,
    );
  }
  console.log(`  ${'ALL'.padEnd(13)} ${String(all.length).padStart(3)}   ${mean(all).toFixed(3)}`);

  const luminance = mean(
    entries.filter((e) => e.meanColour).map((e) => hexLuminance(e.meanColour!)),
  );
  console.log(`  mean luminance        ${luminance.toFixed(3)}`);
}

/* ------------------------------------------------------------------------------- the report ---- */

function row(label: string, m: Measurement, note = ''): string {
  return (
    `  ${label.padEnd(22)} ${m.saturation.toFixed(3).padStart(10)} ` +
    `${m.luminance.toFixed(3).padStart(10)} ${m.contrast.toFixed(3).padStart(10)} ` +
    `${(m.nearWhite * 100).toFixed(1).padStart(8)}%  ${note}`
  );
}

async function main(): Promise<void> {
  if (!existsSync(TARGET_IMAGE)) {
    throw new Error(`${TARGET_IMAGE} is missing — it is the reference this whole measure is against`);
  }

  await preloadAssets(nodeAssetLoader(PUBLIC_ASSETS));
  console.log(`Assets ${assetVersion()}`);

  const target = await measureTarget();
  const control = measureFixture('target');

  console.log('\nComposition, measured inside the plot only');
  console.log(
    `  ${'region'.padEnd(22)} ${'saturation'.padStart(10)} ${'luminance'.padStart(10)} ` +
      `${'contrast'.padStart(10)} ${'near-white'.padStart(9)}`,
  );
  console.log(row('target_design.png', target, '<- the reference'));
  console.log(row('ours: target fixture', control, '<- THE CONTROL, same garden'));

  for (const name of ['suburban', 'l-shape', 'courtyard', 'reference'] as const) {
    console.log(row(`ours: ${name}`, measureFixture(name), 'different garden — context only'));
  }

  const gap = {
    saturation: control.saturation / target.saturation - 1,
    luminance: control.luminance / target.luminance - 1,
    contrast: control.contrast / target.contrast - 1,
  };

  console.log('\nLike-for-like gap (control vs reference), which is what a grade may size itself to');
  console.log(`  saturation  ${(gap.saturation * 100).toFixed(1).padStart(7)}%`);
  console.log(`  luminance   ${(gap.luminance * 100).toFixed(1).padStart(7)}%`);
  console.log(`  contrast    ${(gap.contrast * 100).toFixed(1).padStart(7)}%`);

  /*
   * And the colour balance, which none of the three above can see.
   *
   * Reported as each channel against the picture's own mean, so brightness divides out and what is
   * left is only *warmth*: a warm picture has red over 1 and blue under it. The gap row is what a
   * warm term in the grade may size itself to, and if it reads about zero there is nothing to
   * correct and the term must not be added.
   */
  const balance = (m: Measurement) => {
    const mean = (m.channels.r + m.channels.g + m.channels.b) / 3;
    return mean === 0
      ? { r: 1, g: 1, b: 1 }
      : { r: m.channels.r / mean, g: m.channels.g / mean, b: m.channels.b / mean };
  };
  const targetBalance = balance(target);
  const controlBalance = balance(control);

  console.log('\nColour balance — each channel against the picture\u2019s own mean');
  console.log('  region                      red      green      blue');
  for (const [name, m] of [
    ['target_design.png', targetBalance],
    ['ours: target fixture', controlBalance],
  ] as const) {
    console.log(
      `  ${name.padEnd(24)}${m.r.toFixed(3).padStart(7)}${m.g.toFixed(3).padStart(11)}${m.b
        .toFixed(3)
        .padStart(10)}`,
    );
  }
  console.log(
    `  gap                     ${((targetBalance.r / controlBalance.r - 1) * 100)
      .toFixed(1)
      .padStart(6)}%${((targetBalance.g / controlBalance.g - 1) * 100)
      .toFixed(1)
      .padStart(10)}%${((targetBalance.b / controlBalance.b - 1) * 100).toFixed(1).padStart(9)}%`,
  );

  if (target.nearWhite > 0.05) {
    console.log(
      `\n  WARNING: ${(target.nearWhite * 100).toFixed(1)}% of the target region is near-white. ` +
        `TARGET_PLOT is catching page or panel rather than garden, and every number above is wrong.`,
    );
  }

  console.log('\nThe planting itself, from the scene rather than from the pixels');
  console.log(
    `  ${'fixture'.padEnd(12)} ${'plants'.padStart(7)} ${'bed m²'.padStart(8)} ${'per m²'.padStart(8)} ` +
      `${'mean ⌀'.padStart(8)} ${'cover'.padStart(7)} ${'bare'.padStart(7)} ${'<0.5 m'.padStart(8)} ${'canopy'.padStart(8)}`,
  );
  for (const name of ['target', 'suburban', 'l-shape', 'reference', 'naturalistic'] as const) {
    const m = measurePlanting(loadFixture(name));
    console.log(
      `  ${name.padEnd(12)} ${String(m.plants).padStart(7)} ${m.bedArea.toFixed(1).padStart(8)} ` +
        `${m.perSquareMetre.toFixed(1).padStart(8)} ${m.meanSpread.toFixed(2).padStart(8)} ` +
        `${(m.cover * 100).toFixed(0).padStart(6)}% ${((1 - m.cover) * 100).toFixed(0).padStart(6)}% ` +
        `${(m.smallShare * 100).toFixed(0).padStart(7)}% ${(m.canopy * 100).toFixed(0).padStart(7)}%`,
    );
  }
  console.log('  a real border: about 5-7 per m² plus 0.5-1.5 shrubs, cover near 100% by year three');

  measurePalette();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
