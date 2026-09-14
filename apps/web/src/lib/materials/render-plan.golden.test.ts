import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  boundaryPolygon,
  boundingBox,
  lightDirection,
  readPlanDocument,
  type PlanDocument,
} from '@garden-studio/schema';
import { drawPlan, type PlanContext, type PlanScene } from './render-plan';
import type { MakeCanvas, PatternCanvas } from './render-surface-pattern';
import type { BuildOptions } from '../render/build-scene';

/**
 * The gate: **2D Plan does not change.**
 *
 * This existed only as a habit before. `scripts/render-plan.ts` says so in its own header — "Nothing
 * here asserts anything" — and `preview-dir.ts` keeps exactly one previous run inside a gitignored
 * folder, so running the script twice destroys the baseline you were going to compare against. Every
 * presentation change to Visualise edits files both views share (`render-plan.ts`, `light.ts`,
 * `build-scene.ts`), which makes a silent plan-view regression the likeliest way that work goes
 * wrong, and nothing in the suite could see it.
 *
 * So: real generator fixtures, drawn through the real composer, against committed bytes.
 *
 *     scene ──▶ drawPlan (view: 'plan') ──▶ RGBA ──┐
 *                                                  ├─▶ per-channel |diff| <= TOLERANCE
 *     __golden__/plan-<fixture>.png ──▶ RGBA ──────┘
 *
 * **Tolerance 2, not equality, and that is the repo's own convention rather than a softening.**
 * `render-surface-pattern.test.ts:711` already draws the line in the same place: `stripe` and the
 * other axis-aligned patterns demand 0, and the curved ones — `scatter`, `board` — allow 2, because
 * their rasteriser's coverage arithmetic shifts by a channel step even for pixels far inside the
 * shape. A whole plan contains both, so the looser of the two rules governs. Demanding equality here
 * would be restating an absolute nobody can keep, and the first flake would have somebody delete the
 * test.
 *
 * **Regenerating is deliberate, not a convenience.** `GOLDEN_UPDATE=1 pnpm test` rewrites the
 * references, and the only honest reason to do it is that you changed the plan drawing **on purpose**
 * and have looked at `pnpm render:plan` to confirm the change is the one you meant. Regenerating to
 * get green is how this test becomes worthless.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '__golden__');
const FIXTURES = join(HERE, '..', '..', '..', 'scripts', 'fixtures');

const UPDATE = process.env.GOLDEN_UPDATE === '1';

/** The editor's default zoom — the one `lod.ts` tiers are tuned against and the sheets lead with. */
const PX_PER_METRE = 26;
const MARGIN_METRES = 1;
const PAPER = '#f4f2ed';

/**
 * Per channel, matching `render-surface-pattern.test.ts:711`. See the header: a plan contains curved
 * patterns, and those are not byte-stable against a rasteriser's coverage arithmetic.
 */
const TOLERANCE = 2;

/**
 * Three fixtures rather than all eleven, chosen for coverage rather than count: `suburban` is the
 * reference plan and carries a driveway and a side gate, `l-shape` is a bungalow so `houseHeight`
 * and therefore the shadow length actually differ, and `courtyard` has no viable lawn so the
 * template falls to its small-garden branch. Between them every painter runs.
 */
const FIXTURE_NAMES = ['suburban', 'l-shape', 'courtyard'] as const;

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

interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Deliberately no `assets` in the pass.
 *
 * With no asset loader the painters fall back to their procedural patterns, which is a supported and
 * fully deterministic state — the app is built to work with no key and no files. Committing bytes
 * that depended on 30 MB of checked-in WebP would make this test fail whenever an asset was
 * regenerated, which is a different change from the one it exists to catch.
 */
function render(scene: PlanScene, options: BuildOptions = {}): Raster {
  const box = boundingBox(scene.boundary);
  const width = Math.ceil((box.width + MARGIN_METRES * 2) * PX_PER_METRE);
  const height = Math.ceil((box.length + MARGIN_METRES * 2) * PX_PER_METRE);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  drawPlan(
    context as unknown as PlanContext,
    scene,
    {
      pxPerMetre: PX_PER_METRE,
      light: lightDirection(scene.site) ?? undefined,
      makeCanvas,
    },
    { x: box.minX - MARGIN_METRES, y: box.minY - MARGIN_METRES },
    options,
  );

  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

function writeGolden(file: string, raster: Raster): void {
  const canvas = createCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(raster.width, raster.height);
  image.data.set(raster.data);
  context.putImageData(image, 0, 0);
  mkdirSync(GOLDEN_DIR, { recursive: true });
  writeFileSync(file, canvas.toBuffer('image/png'));
}

async function readGolden(file: string): Promise<Raster> {
  const image = await loadImage(readFileSync(file));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);

  return {
    data: context.getImageData(0, 0, image.width, image.height).data,
    width: image.width,
    height: image.height,
  };
}

/** The worst channel anywhere, and where it was — a bare count says nothing about what moved. */
function worstDifference(
  now: Raster,
  then: Raster,
): { worst: number; over: number; at: { x: number; y: number } | null } {
  let worst = 0;
  let over = 0;
  let where: { x: number; y: number } | null = null;

  for (let index = 0; index < now.data.length; index += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(now.data[index + channel]! - then.data[index + channel]!);
      if (difference > TOLERANCE) over += 1;
      if (difference > worst) {
        worst = difference;
        const pixel = index / 4;
        where = { x: pixel % now.width, y: Math.floor(pixel / now.width) };
      }
    }
  }

  return { worst, over, at: where };
}

describe('2D Plan is unchanged', () => {
  for (const name of FIXTURE_NAMES) {
    it(`draws ${name} exactly as the committed reference`, async () => {
      const scene = sceneOf(loadFixture(name));
      const now = render(scene);
      const file = join(GOLDEN_DIR, `plan-${name}.png`);

      if (UPDATE || !existsSync(file)) {
        writeGolden(file, now);
        expect(existsSync(file)).toBe(true);
        return;
      }

      const then = await readGolden(file);

      expect({ width: now.width, height: now.height }).toEqual({
        width: then.width,
        height: then.height,
      });

      const { worst, over, at } = worstDifference(now, then);

      expect(
        over,
        `${name}: ${over} channels differ by more than ${TOLERANCE} (worst ${worst}` +
          `${at ? ` at ${at.x},${at.y}` : ''}). The 2D Plan drawing changed. Look at ` +
          `\`pnpm render:plan\` before doing anything else. If the change is genuinely intended, ` +
          `regenerate with \`GOLDEN_UPDATE=1 pnpm test\`.`,
      ).toBe(0);
    });
  }

  /**
   * The other half, and it is not decoration.
   *
   * A test that only demands "the plan view did not change" passes perfectly when a presentation
   * change silently does nothing at all — a grade wired to the wrong branch, a wash inside a
   * condition that is never true. Pinning that Visualise *does* differ means the pair can only both
   * be green when the change landed where it was meant to and nowhere else.
   */
  it('renders Visualise differently from the plan view', () => {
    const scene = sceneOf(loadFixture('suburban'));

    const plan = render(scene, { view: 'plan' });
    const visualise = render(scene, { view: 'visualise' });

    const { over } = worstDifference(visualise, plan);
    expect(over).toBeGreaterThan(0);
  });
});
