import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  SectionPatchResultSchema,
  readPlanDocument,
  type PlanDocument,
} from '@garden-studio/schema';

/**
 * The AI designer, watched end to end in a real browser.
 *
 * Everything below the canvas is already covered by unit tests against the executor and the store;
 * what only a browser can answer is whether the run reaches the garden at all — whether the Konva
 * layers mount, whether the plan the user is looking at actually changes, and whether the editor is
 * still theirs afterwards. The Konva canvases have no unit tests anywhere in this project for the
 * same reason.
 */

const api = 'http://localhost:3001';
let projectId: string;
let originalLayout: PlanDocument['layout'];

test.beforeAll(async ({ request }) => {
  const document = readPlanDocument(
    JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')),
  );

  const created = await request.post(`${api}/plan-projects`, {
    data: { name: 'AI redesign · demonstration' },
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

  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, {
    data: {
      revision: project.revision,
      section: { elements: chosen.elements, seededFrom: chosen.id, pristine: chosen.elements },
    },
  });
  expect(saved.ok()).toBe(true);
  const savedResult = SectionPatchResultSchema.parse(await saved.json());
  expect(savedResult.violations).toEqual([]);
  originalLayout = savedResult.project.document.layout;
});

/** The terrace, found the way the demonstration script finds it. */
function terraceOf(layout: PlanDocument['layout']) {
  return layout.elements
    .filter(
      (element) =>
        element.category === 'paved-area' && element.role === 'feature' && element.shape.kind === 'rect',
    )
    .sort((a, b) => {
      const size = (shape: typeof a.shape) => (shape.kind === 'rect' ? shape.width * shape.depth : 0);
      return size(b.shape) - size(a.shape);
    })[0]!;
}

async function openEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/plan/${projectId}/editor?aiDemo`);
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  return errors;
}

/**
 * The terrace's area as the properties panel reports it.
 *
 * Read off the panel rather than the store, because what is being checked is that the change
 * reached the thing the user is looking at — a run that moved geometry nothing displayed would
 * pass every unit test in the project.
 */
async function terraceArea(page: Page, id: string): Promise<number> {
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${id}`).getByRole('button').first().click();
  const text = (await page.getByTestId('element-area').textContent()) ?? '';
  const parsed = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
}

test('the AI designer visibly redesigns the plan, and the plan is still the user\'s afterwards', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  const areaBefore = await terraceArea(page, terrace.id);
  expect(areaBefore).toBeGreaterThan(0);

  await page.getByTestId('ai-demo-run').click();

  // It announces itself: a stage in progress, a designer at work, a label on the canvas.
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('ai-label-chip')).toBeVisible();
  await expect(page.locator('[data-testid^="ai-stage-"][data-state="current"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="ai-agent-"][data-state="active"]').first()).toBeVisible();

  // The user's own tools are the AI's for the moment, and Continue says so rather than hanging.
  await expect(page.getByTestId('continue')).toBeDisabled();

  await page.getByTestId('ai-skip').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('ai-label-chip')).toBeHidden();

  // The garden actually changed, and the change is in the document rather than only on screen.
  const areaAfter = await terraceArea(page, terrace.id);
  expect(areaAfter).toBeGreaterThan(areaBefore);
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  // Compare shows the plan as it was, and changes neither the plan nor its history.
  await page.getByTestId('ai-compare').click();
  await expect(page.getByTestId('ai-compare-banner')).toBeVisible();
  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaAfter, 1);
  await page.getByTestId('ai-compare').click();
  await expect(page.getByTestId('ai-compare-banner')).toBeHidden();

  // One Undo puts the whole redesign back, however many operations it ran.
  await page.getByTestId('ai-undo').click();
  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaBefore, 1);

  expect(errors).toEqual([]);
});

test('a redesign can be stopped, and leaves nothing behind', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  const areaBefore = await terraceArea(page, terrace.id);

  await page.getByTestId('ai-demo-run').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');
  await page.getByTestId('ai-stop').click();

  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'cancelled');
  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaBefore, 1);

  // Stopping is not an edit: there is nothing on the undo stack to take back.
  await page.getByTestId('editor-canvas').click({ position: { x: 5, y: 5 } });
  expect(errors).toEqual([]);
});
