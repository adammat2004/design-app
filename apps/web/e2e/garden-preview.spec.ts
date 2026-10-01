import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { buildArScene } from '@garden-studio/ar-builder';
import {
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  readPlanDocument,
  SectionPatchResultSchema,
} from '@garden-studio/schema';

/**
 * The whole-garden preview, in a real browser with real WebGL: it opens from the editor and from the
 * review screen, draws the scene the builder makes for the stored plan (the counts on its wrapper
 * are compared with the builder's own), switches views, still draws when its sky, textures and
 * models are unreachable, and closes back to where it was opened. Nothing it does changes the plan.
 */
const api = 'http://localhost:3001';
let projectId: string;

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ request }) => {
  const document = readPlanDocument(JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')));
  const created = await request.post(`${api}/plan-projects`, { data: { name: 'Garden preview verification' } });
  expect(created.ok()).toBe(true);
  let project = PlanProjectSchema.parse(await created.json());
  projectId = project.id;
  for (const [section, value] of [['site', document.site], ['brief', document.brief]] as const) {
    const result = await request.patch(`${api}/plan-projects/${projectId}/${section}`, { data: { revision: project.revision, section: value } });
    expect(result.ok()).toBe(true);
    project = SectionPatchResultSchema.parse(await result.json()).project;
  }
  const generated = await request.post(`${api}/plan-projects/${projectId}/concepts/generate`, { data: { revision: project.revision, mode: 'all' } });
  expect(generated.ok()).toBe(true);
  const result = GenerateConceptsResultSchema.parse(await generated.json());
  const chosen = result.concepts.find((concept) => concept.recommended)!;
  project = result.project;
  const selected = await request.patch(`${api}/plan-projects/${projectId}/concept-selection`, {
    data: { revision: project.revision, selectedId: chosen.id, chosenConceptId: chosen.id },
  });
  expect(selected.ok()).toBe(true);
  project = SectionPatchResultSchema.parse(await selected.json()).project;
  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, {
    data: { revision: project.revision, section: { elements: chosen.elements, seededFrom: chosen.id, pristine: chosen.elements } },
  });
  expect(saved.ok()).toBe(true);
});

/** What the builder makes of the stored plan: the numbers the preview's wrapper must report. */
async function expectedCounts(request: APIRequestContext) {
  const project = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  const { scene } = buildArScene(
    {
      site: project.document.site,
      elements: project.document.layout.elements,
      // The brief's style, budget and upkeep decide what automatic edging lays, in the preview as on the plan.
      edgeRules: {
        style: project.document.brief.style ?? null,
        budget: project.document.brief.budget ?? null,
        maintenance: project.document.brief.maintenance ?? null,
      },
      source: { projectId, projectName: project.name, revision: project.revision, documentVersion: project.document.version },
    },
    { plants: 'desktop' },
  );
  const count = (kind: string) => scene.nodes.filter((node) => node.kind === kind).length;
  return {
    revision: project.revision,
    surfaces: count('surface'),
    solids: count('solid'),
    models: count('model'),
    plants: scene.nodes.reduce((sum, node) => sum + (node.kind === 'plants' ? node.instances.length : 0), 0),
  };
}

async function expectDrawn(page: Page, expected: Awaited<ReturnType<typeof expectedCounts>>) {
  const viewport = page.getByTestId('garden-preview-viewport');
  await expect(viewport.locator('canvas')).toHaveCount(1);
  await expect(viewport).toHaveAttribute('data-webgl', 'true');
  await expect(viewport).toHaveAttribute('data-surfaces', String(expected.surfaces));
  await expect(viewport).toHaveAttribute('data-solids', String(expected.solids));
  await expect(viewport).toHaveAttribute('data-models', String(expected.models));
  await expect(viewport).toHaveAttribute('data-plants', String(expected.plants));
  await expect(viewport).toHaveAttribute('data-origin', 'garden-door');
  // The finish reports once the renderer is up: a tier means the Canvas really came to life.
  await expect(viewport).toHaveAttribute('data-render-tier', /^(high|low)$/);
  expect(expected.surfaces).toBeGreaterThan(0);
  expect(expected.plants).toBeGreaterThan(0);
}

test('the editor opens the whole garden in 3D, and closing it changes nothing', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const expected = await expectedCounts(request);

  await page.goto(`/plan/${projectId}/editor`);
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  await page.getByTestId('view-in-3d').click();
  await expectDrawn(page, expected);

  const viewport = page.getByTestId('garden-preview-viewport');
  await expect(viewport).toHaveAttribute('data-view', 'door');
  await page.getByTestId('garden-preview-view-overview').click();
  await expect(viewport).toHaveAttribute('data-view', 'overview');
  await expect(viewport.locator('canvas')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('garden-preview')).toHaveCount(0);
  await expect(page.getByTestId('editor-canvas').locator('canvas').first()).toBeVisible();

  // Looking is not editing: the stored plan is exactly as it was.
  const after = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  expect(after.revision).toBe(expected.revision);
  expect(errors).toEqual([]);
});

test('the review screen opens it too, and it still draws with its sky, textures and models unreachable', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/assets/hdri/**', (route) => route.abort());
  await page.route('**/assets/pbr/**', (route) => route.abort());
  await page.route('**/models/**', (route) => route.abort());
  const expected = await expectedCounts(request);

  await page.goto(`/plan/${projectId}/review`);
  await page.getByTestId('view-in-3d').click();
  await expectDrawn(page, expected);
  await expect(page.getByTestId('garden-preview-viewport')).toHaveAttribute('data-sky', 'failed');

  await page.getByTestId('garden-preview-close').click();
  await expect(page.getByTestId('garden-preview')).toHaveCount(0);
  await expect(page.getByTestId('view-in-3d')).toBeVisible();
  expect(errors).toEqual([]);
});
