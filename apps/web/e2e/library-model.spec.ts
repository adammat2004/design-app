import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { buildArScene } from '@garden-studio/ar-builder';
import { ModelLibrarySchema, type SolidNode } from '@garden-studio/ar-contract';
import {
  boundaryPolygon,
  elementIsLegal,
  elementOutline,
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  polygonCentroid,
  readPlanDocument,
  SectionPatchResultSchema,
  type DesignElement,
} from '@garden-studio/schema';

/**
 * The model library in a real browser: a gazebo the library depicts is drawn with the Meshy model —
 * in the whole-garden preview and in its own 3D editor — **exactly over its footprint**, measured
 * from the box the model was actually drawn in rather than from the numbers that asked for it. A
 * resize past the model's band draws the parts, and one back inside draws the model again. With the
 * model's file unreachable, the parts draw and nothing throws.
 *
 * Screenshots go to `test-results/library-model/` to be looked at: some faults in 3D are only found
 * by looking, which is the rule the whole-garden preview was built by.
 */
const api = 'http://localhost:3001';
const MODEL_ID = 'gazebo-classic-dark-stained-3x3';
const SHOTS = resolve('test-results/library-model');
const LIBRARY = ModelLibrarySchema.parse(
  JSON.parse(readFileSync(resolve('public/models/library/library.json'), 'utf8')),
);
let projectId: string;
let gazebo: DesignElement;

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ request }) => {
  mkdirSync(SHOTS, { recursive: true });
  const document = readPlanDocument(
    JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')),
  );
  const created = await request.post(`${api}/plan-projects`, {
    data: { name: 'Library model verification' },
  });
  expect(created.ok()).toBe(true);
  let project = PlanProjectSchema.parse(await created.json());
  projectId = project.id;
  for (const [section, value] of [
    ['site', document.site],
    ['brief', document.brief],
  ] as const) {
    const result = await request.patch(`${api}/plan-projects/${projectId}/${section}`, {
      data: { revision: project.revision, section: value },
    });
    expect(result.ok()).toBe(true);
    project = SectionPatchResultSchema.parse(await result.json()).project;
  }

  // The editor works on a chosen concept, so the plan is generated and one chosen, as a user would.
  const generated = await request.post(`${api}/plan-projects/${projectId}/concepts/generate`, {
    data: { revision: project.revision, mode: 'all' },
  });
  expect(generated.ok()).toBe(true);
  const result = GenerateConceptsResultSchema.parse(await generated.json());
  const chosen = result.concepts.find((concept) => concept.recommended)!;
  project = result.project;
  const selected = await request.patch(`${api}/plan-projects/${projectId}/concept-selection`, {
    data: { revision: project.revision, selectedId: chosen.id, chosenConceptId: chosen.id },
  });
  expect(selected.ok()).toBe(true);
  project = SectionPatchResultSchema.parse(await selected.json()).project;

  /*
   * A gazebo as the published model depicts it — a dark-stained frame and dark shingles — square to
   * the plan, put somewhere the editor's own rule accepts a 3 m footprint: a lawn's middle, or a
   * paved area's.
   */
  const boundary = boundaryPolygon(document.site);
  const at = (point: { x: number; y: number }): DesignElement => ({
    id: 'library-gazebo',
    category: 'structure',
    role: 'feature',
    name: 'Shingled gazebo',
    symbol: 'gazebo',
    zone: 'back',
    material: 'dark-stained-timber',
    height: 2.8,
    shape: { kind: 'rect', centre: point, width: 3, depth: 3, rotation: 0 },
    structure: {
      preset: 'classic',
      model: 'classic',
      roof: { kind: 'hipped', finish: 'shingle-dark' },
    },
  });
  const candidate = chosen.elements
    .filter((element) => element.category === 'lawn' || element.category === 'paved-area')
    .map((element) => at(polygonCentroid(elementOutline(element))))
    .find((element) => elementIsLegal(element, boundary));
  expect(candidate, 'somewhere on the plan a 3 m gazebo stands').toBeTruthy();
  gazebo = candidate!;

  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, {
    data: {
      revision: project.revision,
      section: {
        elements: [...chosen.elements, gazebo],
        seededFrom: chosen.id,
        pristine: chosen.elements,
      },
    },
  });
  expect(saved.ok()).toBe(true);
});

/** What the builder puts on the gazebo's node for the stored plan, with the checked-in library. */
async function expectedAsset(request: APIRequestContext) {
  const project = PlanProjectSchema.parse(
    await (await request.get(`${api}/plan-projects/${projectId}`)).json(),
  );
  const { scene } = buildArScene(
    {
      site: project.document.site,
      elements: project.document.layout.elements,
      // The brief's style, budget and upkeep decide what edging is laid, here as in the preview.
      edgeRules: {
        style: project.document.brief.style ?? null,
        budget: project.document.brief.budget ?? null,
        maintenance: project.document.brief.maintenance ?? null,
      },
      source: {
        projectId,
        projectName: project.name,
        revision: project.revision,
        documentVersion: project.document.version,
      },
    },
    { plants: 'desktop', library: LIBRARY },
  );
  const node = scene.nodes.find((candidate) => candidate.sourceId === gazebo.id) as
    SolidNode | undefined;
  expect(node?.asset?.id).toBe(MODEL_ID);
  return {
    asset: node!.asset!,
    solids: scene.nodes.filter((candidate) => candidate.kind === 'solid').length,
  };
}

async function openPreview(page: import('@playwright/test').Page) {
  await page.goto(`/plan/${projectId}/editor`);
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  await page.getByTestId('view-in-3d').click();
  const viewport = page.getByTestId('garden-preview-viewport');
  await expect(viewport.locator('canvas')).toHaveCount(1);
  await expect(viewport).toHaveAttribute('data-render-tier', /^(high|low)$/);
  return viewport;
}

test('the preview draws the gazebo with its library model, exactly over its footprint', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { asset } = await expectedAsset(request);

  const viewport = await openPreview(page);
  await expect(viewport).toHaveAttribute('data-assets', '1', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-library-models', 'ready', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-assets-drawn', '1');

  // Square to the plan, so the drawn box is the footprint itself: centred on the asset's base
  // centre, as wide and deep as the gazebo, standing from its base to its height.
  const boxes = JSON.parse((await viewport.getAttribute('data-asset-boxes'))!) as Record<
    string,
    { min: number[]; max: number[] }
  >;
  const drawn = boxes[gazebo.id]!;
  const [x, y, z] = asset.position;
  const [w, h, d] = asset.size;
  const expected = { min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2] };
  for (const axis of [0, 1, 2]) {
    expect(Math.abs(drawn.min[axis]! - expected.min[axis]!), `min ${axis}`).toBeLessThan(0.01);
    expect(Math.abs(drawn.max[axis]! - expected.max[axis]!), `max ${axis}`).toBeLessThan(0.01);
  }

  await page.waitForTimeout(1500);
  await viewport.screenshot({ path: `${SHOTS}/preview-door.png` });
  await page.getByTestId('garden-preview-view-overview').click();
  await page.waitForTimeout(1500);
  await viewport.screenshot({ path: `${SHOTS}/preview-overview.png` });
  expect(errors).toEqual([]);
});

test('with the model file unreachable, the gazebo draws its own parts and nothing breaks', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/models/library/*.glb', (route) => route.abort());
  const { solids } = await expectedAsset(request);

  const viewport = await openPreview(page);
  // The scene still names the model — the library loaded — but its file never arrives.
  await expect(viewport).toHaveAttribute('data-assets', '1', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-library-models', 'failed', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-assets-drawn', '0');
  await expect(viewport).toHaveAttribute('data-solids', String(solids));
  expect(errors).toEqual([]);
});

test('its 3D editor draws the model, and a resize past the model’s size draws the parts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`/plan/${projectId}/editor`);
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${gazebo.id}`).getByRole('button').first().click();
  await page.getByTestId('edit-in-3d').click();

  const viewport = page.getByTestId('structure-viewport');
  await expect(viewport.locator('canvas')).toHaveCount(1);
  await expect(viewport).toHaveAttribute('data-look', `model:${MODEL_ID}`, { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-library-models', 'ready', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await viewport.screenshot({ path: `${SHOTS}/editor-model.png` });

  /*
   * 3.5 m tall is 20% over the model's 2.9 m: past its band, so the parts draw, at once. Height
   * rather than width because a taller gazebo runs into nothing — a 4.5 m wide one met its
   * neighbours and the editor rightly refused the resize.
   */
  await page.getByTestId('structure-tab-size').click();
  const height = page.getByTestId('structure-height');
  await height.fill('3.5');
  await height.press('Tab');
  await expect(viewport).toHaveAttribute('data-height', '3.5');
  await expect(viewport).toHaveAttribute('data-look', 'parts:no-model-fits');
  await page.waitForTimeout(800);
  await viewport.screenshot({ path: `${SHOTS}/editor-parts.png` });

  // And back inside its band, the model again.
  await height.fill('3');
  await height.press('Tab');
  await expect(viewport).toHaveAttribute('data-height', '3');
  await expect(viewport).toHaveAttribute('data-look', `model:${MODEL_ID}`);
  expect(errors).toEqual([]);
});
