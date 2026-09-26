import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  boundaryPolygon,
  boundingBox,
  elementCentreline,
  elementOutline,
  gardenDoors,
  housePolygon,
  isCounted,
  isTreeSymbol,
  openingCentre,
  openingNormal,
  polygonCentroid,
  resolveSymbol,
  lightDirection,
  nightFraction,
  readPlanDocument,
  shadowCast,
  stepFlight,
  type DesignElement,
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
import { edgeRulesOf } from '../src/lib/edge-rules';

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

// `target` last and deliberately: it is `target_design.png` traced by hand, not generator output,
// and the sheet exists to compare the generated plans against it.
const FIXTURE_NAMES = ['suburban', 'l-shape', 'courtyard', 'reference', 'small', 'wide', 'narrow', 'formal', 'naturalistic', 'entertaining', 'target'] as const;

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
    // The fixture's own brief, so the sheet resolves its edging as the editor would.
    edgeRules: edgeRulesOf(document.brief),
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

/** Same-sized judging frames reveal whether improvements survive different plot proportions. */
async function compositionSheet(): Promise<Buffer> {
  const columns = 6;
  const cellWidth = 360;
  const cellHeight = 460;
  // Rows from the fixture count, so adding one does not silently fall off the bottom of the sheet.
  const rows = Math.ceil(FIXTURE_NAMES.length / columns);
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, name] of FIXTURE_NAMES.entries()) {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const prefix = String(index + 1).padStart(2, '0');
    const image = await loadImage(join(OUT_DIR, `${prefix}-${name}-close-visualise.png`));
    const scale = Math.min((cellWidth - 24) / image.width, (cellHeight - 48) / image.height);
    context.drawImage(image, x + (cellWidth - image.width * scale) / 2,
      y + 38 + (cellHeight - 48 - image.height * scale) / 2, image.width * scale, image.height * scale);
    context.fillStyle = '#243d31';
    context.font = 'bold 16px sans-serif';
    context.fillText(`${prefix} · ${name}`, x + 18, y + 26);
  }
  return canvas.toBuffer('image/png');
}

/* ---------------------------------------------------------------- the schematic */

/**
 * The plan drawn as a designer's diagram: what each thing *is* and why it is there, nothing else.
 *
 * The photographic render hides exactly what the generator is judged on. A lawn notched round a
 * room, a path running beside the grass rather than across it, a store standing clear of the view —
 * all of it reads at a glance in flat colour and all of it is lost under slabs, sprites and shadows.
 * So: one flat tone per category, routes as dark strips with an arrow at the end they arrive at,
 * trees as the canopy's outline, the line out of the garden door, and each element's `purpose` written
 * on it. A plan that looks right here and wrong in the render has a rendering problem; one that looks
 * wrong here has a composition problem.
 *
 * **The view is drawn as the line out of the door, not the scorer's cone.** The cone's angle is the
 * API's constant, and restating it here would be a second answer to a settled question; the line is
 * derived from the door alone, and it is what a focal point terminates.
 */
const SCHEMATIC_PX = 26;

const FLAT: Partial<Record<DesignElement['category'], string>> = {
  lawn: '#bcd9a4',
  'planting-bed': '#6f9a5c',
  'paved-area': '#cfc6b6',
  'gravel-mulch': '#e6dcc3',
  structure: '#8a6b4e',
  'water-feature': '#7fb3d5',
  'existing-feature': '#9a9a9a',
};

function schematicPlan(document: PlanDocument): Buffer {
  const boundary = boundaryPolygon(document.site);
  const box = boundingBox(boundary);
  const px = SCHEMATIC_PX;
  const width = Math.ceil((box.width + MARGIN_METRES * 2) * px);
  const height = Math.ceil((box.length + MARGIN_METRES * 2) * px);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const at = (point: Point) => ({
    x: (point.x - box.minX + MARGIN_METRES) * px,
    y: (point.y - box.minY + MARGIN_METRES) * px,
  });
  const ring = (points: Point[]) => {
    context.beginPath();
    points.forEach((point, index) => {
      const p = at(point);
      if (index === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    context.closePath();
  };

  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  const elements = document.layout.elements.filter(
    (element) => !element.hidden && !isCounted(element.category),
  );
  const isTree = (element: DesignElement) => {
    const symbol = resolveSymbol(element);
    return symbol !== null && isTreeSymbol(symbol);
  };
  const isShrub = (element: DesignElement) => element.symbol?.startsWith('shrub') ?? false;

  /* Ground first, base fills paler, so the accents read as the designed ground they are. */
  for (const element of elements) {
    if (element.shape.kind === 'polyline' || isTree(element) || isShrub(element)) continue;
    const tone = FLAT[element.category];
    if (!tone) continue;
    context.globalAlpha = element.fillKind === 'base' ? 0.45 : 1;
    context.fillStyle = tone;
    ring(elementOutline(element));
    context.fill();
    if (element.role === 'feature') {
      context.globalAlpha = 1;
      context.strokeStyle = '#3b3b3b';
      context.lineWidth = 1;
      context.stroke();
    }
  }
  context.globalAlpha = 1;

  /* Routes: a dark strip, and an arrowhead where the route arrives. */
  for (const element of elements) {
    if (element.shape.kind !== 'polyline') continue;
    context.fillStyle = 'rgba(40, 40, 40, 0.78)';
    ring(elementOutline(element));
    context.fill();
    const line = elementCentreline(element);
    if (!line || line.length < 2) continue;
    const tip = at(line[line.length - 1]!);
    const back = at(line[line.length - 2]!);
    const angle = Math.atan2(tip.y - back.y, tip.x - back.x);
    context.fillStyle = '#f4f2ed';
    context.beginPath();
    context.moveTo(tip.x, tip.y);
    context.lineTo(tip.x - 9 * Math.cos(angle - 0.45), tip.y - 9 * Math.sin(angle - 0.45));
    context.lineTo(tip.x - 9 * Math.cos(angle + 0.45), tip.y - 9 * Math.sin(angle + 0.45));
    context.closePath();
    context.fill();
  }

  /* Trees as the canopy's outline, with the trunk as a dot. */
  for (const element of elements) {
    if (!isTree(element) || element.shape.kind !== 'point') continue;
    const centre = at(element.shape.at);
    context.strokeStyle = '#2f5a2a';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(centre.x, centre.y, element.shape.radius * px, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#2f5a2a';
    context.beginPath();
    context.arc(centre.x, centre.y, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  /* The house, the boundary, and the line out of the garden door. */
  if (document.site.house) {
    context.fillStyle = '#4a4f55';
    ring(housePolygon(document.site.house));
    context.fill();
    const door = gardenDoors(document.site.house)[0];
    const centre = door ? openingCentre(document.site.house, door) : null;
    const normal = door ? openingNormal(document.site.house, door) : null;
    const far = centre && normal ? rayToRing(centre, normal, boundary) : null;
    if (centre && far) {
      const a = at(centre);
      const b = at(far);
      context.strokeStyle = '#b3372f';
      context.lineWidth = 1.5;
      context.setLineDash([6, 5]);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      context.setLineDash([]);
    }
  }
  context.strokeStyle = '#1f1f1f';
  context.lineWidth = 2;
  ring(boundary);
  context.stroke();

  /* What each thing is for, written on it. */
  context.font = '11px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const element of elements) {
    if (!element.purpose || element.fillKind === 'base' || isTree(element) || isShrub(element)) continue;
    const outline = elementOutline(element);
    const line = element.shape.kind === 'polyline' ? elementCentreline(element) : null;
    const anchor = line ? line[Math.floor(line.length / 2)]! : polygonCentroid(outline);
    const p = at(anchor);
    const text = element.purpose.replace(/-/g, ' ');
    const w = context.measureText(text).width + 6;
    context.fillStyle = 'rgba(255, 255, 255, 0.82)';
    context.fillRect(p.x - w / 2, p.y - 7, w, 14);
    context.fillStyle = '#1d2b22';
    context.fillText(text, p.x, p.y);
  }

  return canvas.toBuffer('image/png');
}

/** Where a ray from `from` along `direction` first leaves `ring`, or `null` if it never crosses it. */
function rayToRing(from: Point, direction: Point, ring: Point[]): Point | null {
  let best: number | null = null;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = direction.x * ey - direction.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / denom;
    const s = ((a.x - from.x) * direction.y - (a.y - from.y) * direction.x) / denom;
    if (t > 1e-6 && s >= 0 && s <= 1 && (best === null || t < best)) best = t;
  }
  return best === null ? null : { x: from.x + direction.x * best, y: from.y + direction.y * best };
}

/** Every fixture's schematic, side by side, the way the composition sheet sets out the renders. */
async function schematicSheet(): Promise<Buffer> {
  const columns = 6;
  const cellWidth = 360;
  const cellHeight = 460;
  const rows = Math.ceil(FIXTURE_NAMES.length / columns);
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, name] of FIXTURE_NAMES.entries()) {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const prefix = String(index + 1).padStart(2, '0');
    const image = await loadImage(join(OUT_DIR, `${prefix}-${name}-schematic.png`));
    const scale = Math.min((cellWidth - 24) / image.width, (cellHeight - 48) / image.height);
    context.drawImage(image, x + (cellWidth - image.width * scale) / 2,
      y + 38 + (cellHeight - 48 - image.height * scale) / 2, image.width * scale, image.height * scale);
    context.fillStyle = '#243d31';
    context.font = 'bold 16px sans-serif';
    context.fillText(`${prefix} · ${name}`, x + 18, y + 26);
  }
  return canvas.toBuffer('image/png');
}

/**
 * A raised terrace, its retaining wall, a flight down off it and a kerbed path.
 *
 * **Synthesised, because no captured fixture has any of it.** The generator raises a terrace only on
 * a formal or modern brief at a high budget and none of the eleven fixtures lands there, so levels,
 * steps and walling have never appeared on a judging sheet — which is exactly how they came to be
 * the last things nobody had looked at. The alternative was re-capturing fixtures against the API
 * and changing every other sheet in the process.
 *
 * Everything here is an ordinary edit to a real plan: `elevation` on the terrace, `retaining` naming
 * a walling product, and a `steps` element whose own `elevation` is the rise it serves. The
 * renderer derives the wall, the treads and the risers from those three fields exactly as it would
 * for a plan a user had made.
 */
function levelsSheet(document: PlanDocument): Buffer {
  const RISE_METRES = 0.45;

  const terrace = document.layout.elements.find(
    (element) =>
      element.category === 'paved-area' && element.role === 'feature' && element.shape.kind === 'rect',
  );
  if (!terrace || terrace.shape.kind !== 'rect') {
    throw new Error('the levels sheet needs a fixture with a rectangular terrace');
  }

  const flight = stepFlight(RISE_METRES);
  if (!flight) throw new Error('a 0.45 m rise should always give a flight');

  /*
   * Placed the way `stepsFromTerrace` places one: just beyond the terrace's far edge, turned so its
   * own `-depth/2` end is the one against the terrace. That is the convention `drawFlight` and
   * `stepNosings` both count from, and getting it backwards puts the flight under the house.
   */
  const depth = flight.risers * 0.35;
  // Out along the terrace's own local −y, which is the garden side; then turned to face back.
  const terraceAngle = (terrace.shape.rotation * Math.PI) / 180;
  const reach = terrace.shape.depth / 2 + depth / 2;
  const centre = {
    x: terrace.shape.centre.x + Math.sin(terraceAngle) * reach,
    y: terrace.shape.centre.y - Math.cos(terraceAngle) * reach,
  };
  const rotation = terrace.shape.rotation + 180;

  const steps: DesignElement = {
    id: `${terrace.id}:steps`,
    category: 'structure',
    role: 'feature',
    name: 'Steps',
    symbol: 'steps',
    material: terrace.material,
    zone: terrace.zone,
    height: 0,
    elevation: RISE_METRES,
    shape: {
      kind: 'rect',
      centre,
      width: Math.min(2.4, terrace.shape.width),
      depth,
      rotation,
    },
  } as DesignElement;

  const elements = document.layout.elements.map((element) =>
    element.id === terrace.id
      ? ({ ...element, elevation: RISE_METRES, retaining: 'walling-stone' } as DesignElement)
      : element,
  );

  return renderPlan({ ...sceneOf(document), elements: [...elements, steps] }, 64, {
    view: 'visualise',
  });
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

/**
 * The same garden through dusk into night, which is the sheet the lighting layer is judged by.
 *
 * Four hours rather than two, because the interesting thing about a lighting scheme is the *ramp*:
 * the fittings have to come up before the garden is black, or the transition reads as a switch
 * being thrown. The hours below straddle sunset at the fixture's own latitude, so the second and
 * third frames are the ones to look at.
 */
function lightingHours(document: PlanDocument): Buffer {
  const px = 18;
  const pad = 10;
  const caption = 18;
  const cols = 2;
  const rows = 2;

  const base = sceneOf(document);
  if (!base.site.location) {
    throw new Error('the lighting sheet needs a fixture with a location');
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

  /*
   * Straddling sunset in *solar* time, which is the axis `sunInstant` reads `minutes` on — solar
   * noon is 12:00 exactly, so at the fixture's latitude on day 172 the sun sets around 20:20 and
   * civil twilight ends around 21:05. Clock hours picked by eye landed all three of the last
   * frames past the end of the ramp, which is the sheet showing four pictures of the same night.
   */
  const hours: [string, number][] = [
    ['20:00', 1200],
    ['20:30', 1230],
    ['20:50', 1250],
    ['21:30', 1290],
  ];

  hours.forEach(([label, minutes], index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const ox = pad + col * (plotW + pad);
    const oy = pad + row * (plotH + caption + pad) + caption;

    const site = { ...base.site, sun: { ...base.site.sun, minutes } };
    const scene: PlanScene = { ...base, site };
    const dark = nightFraction(site);

    context.save();
    context.translate(ox, oy);
    /*
     * `light` is deliberately not passed. An explicit light means the caller owns the sun, and
     * `buildRenderScene` answers `null` for the night in that case — so overriding it here would
     * render the one sheet that exists to show the night with the night switched off.
     */
    drawPlan(
      context as unknown as PlanContext,
      scene,
      { pxPerMetre: px, makeCanvas, assets: getAssetVariants },
      { x: box.minX, y: box.minY },
    );
    context.restore();

    context.fillStyle = '#1a231c';
    context.font = 'bold 13px sans-serif';
    context.fillText(
      `${label}  ·  darkness ${dark === null ? 'unknown' : dark.toFixed(2)}`,
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
    write(`${prefix}-${name}-schematic`, schematicPlan(document));
  });

  write('12-levels', levelsSheet(loadFixture('reference')));
  write('04-shadow-hours', shadowHours(loadFixture('suburban')));
  write('04-lighting-hours', lightingHours(loadFixture('suburban')));
  write('00-composition-sheet', await compositionSheet());
  write('00-schematic-sheet', await schematicSheet());

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
