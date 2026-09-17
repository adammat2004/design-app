import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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

/**
 * A project with a chosen concept in its layout, ready to open in the editor.
 *
 * `edit` is applied to the concept's elements before they are saved, which is how a test gets a
 * plan with a fault in it: some faults — a pinched path among them — have no control in the
 * properties panel, so they cannot be made by hand at all. The reviewer's job is to find what is
 * wrong with a plan, not to care how it got that way.
 */
async function seedProject(
  request: APIRequestContext,
  name: string,
  edit: (elements: PlanDocument['layout']['elements']) => PlanDocument['layout']['elements'] = (e) => e,
): Promise<{ id: string; layout: PlanDocument['layout'] }> {
  const document = readPlanDocument(
    JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')),
  );

  const created = await request.post(`${api}/plan-projects`, { data: { name } });
  expect(created.ok()).toBe(true);
  let project = PlanProjectSchema.parse(await created.json());
  const id = project.id;

  for (const [section, value] of [['site', document.site], ['brief', document.brief]] as const) {
    const result = await request.patch(`${api}/plan-projects/${id}/${section}`, {
      data: { revision: project.revision, section: value },
    });
    expect(result.ok()).toBe(true);
    project = SectionPatchResultSchema.parse(await result.json()).project;
  }

  const generated = await request.post(`${api}/plan-projects/${id}/concepts/generate`, {
    data: { revision: project.revision, mode: 'all' },
  });
  expect(generated.ok()).toBe(true);
  const result = GenerateConceptsResultSchema.parse(await generated.json());
  const chosen = result.concepts.find((concept) => concept.recommended)!;
  project = result.project;

  const selected = await request.patch(`${api}/plan-projects/${id}/concept-selection`, {
    data: { revision: project.revision, selectedId: chosen.id, chosenConceptId: chosen.id },
  });
  expect(selected.ok()).toBe(true);
  project = SectionPatchResultSchema.parse(await selected.json()).project;

  const elements = edit(chosen.elements);
  const saved = await request.patch(`${api}/plan-projects/${id}/layout`, {
    data: {
      revision: project.revision,
      section: { elements, seededFrom: chosen.id, pristine: chosen.elements },
    },
  });
  expect(saved.ok()).toBe(true);
  const savedResult = SectionPatchResultSchema.parse(await saved.json());
  expect(savedResult.violations).toEqual([]);
  return { id, layout: savedResult.project.document.layout };
}

test.beforeAll(async ({ request }) => {
  const seeded = await seedProject(request, 'AI redesign · demonstration');
  projectId = seeded.id;
  originalLayout = seeded.layout;
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

/**
 * Everything the page complains about, so a test can demand silence.
 *
 * Konva's layer advisory is collected alongside real errors on purpose. The editor has a layer
 * budget (see the note above the Stage in `EditorCanvas.tsx`), a run is what pushed it over once,
 * and every layer is a full-size canvas — so this is a regression only a browser can see. Matched
 * on Konva's own prefix rather than on `type() === 'warning'`, which keeps React's development
 * warnings out of it.
 */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text().startsWith('Konva warning')) errors.push(message.text());
  });
  return errors;
}

/**
 * One scene canvas per Konva layer, and nothing else sits directly under Konva's container.
 *
 * Scoped to `.konvajs-content >` deliberately: the editor also holds the Pixi canvas and the 2D
 * overlay, which are the canvases `openEditor` waits on, and counting those would measure the
 * renderer rather than the stage.
 */
function konvaLayers(page: Page) {
  return page.locator('[data-testid="editor-canvas"] .konvajs-content > canvas');
}

async function openEditor(page: Page): Promise<string[]> {
  const errors = watchConsole(page);
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

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function boxContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  slack = 1,
): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

/**
 * The designer used to collapse inside a scrolling inspector and paint its chips over Edit.
 * Both panes must stay in the column, and the composer has to stay inside the designer card.
 */
async function assertInspectorPanesDoNotOverlap(page: Page): Promise<void> {
  const designer = await page.getByTestId('design-agent-panel').boundingBox();
  const edit = await page.getByTestId('selected-element').boundingBox();
  expect(designer).not.toBeNull();
  expect(edit).not.toBeNull();
  expect(boxesOverlap(designer!, edit!)).toBe(false);

  const suggestions = page.getByTestId('assistant-suggestions');
  if (await suggestions.isVisible()) {
    const suggestionsBox = await suggestions.boundingBox();
    expect(suggestionsBox).not.toBeNull();
    expect(boxContains(designer!, suggestionsBox!)).toBe(true);
  }

  const send = await page.getByTestId('assistant-send').boundingBox();
  expect(send).not.toBeNull();
  expect(boxContains(designer!, send!)).toBe(true);
}

test('the AI designer visibly redesigns the plan, and the plan is still the user\'s afterwards', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  const areaBefore = await terraceArea(page, terrace.id);
  expect(areaBefore).toBeGreaterThan(0);

  // Three layers idle: backdrop, elements, chrome. The budget is stated above the Stage.
  await expect(konvaLayers(page)).toHaveCount(3);

  await page.getByTestId('ai-demo-run').click();

  // It announces itself: a stage in progress, a designer at work, a label on the canvas — and
  // exactly one layer of its own, not two.
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('ai-label-chip')).toBeVisible();
  await expect(konvaLayers(page)).toHaveCount(4);
  await expect(page.locator('[data-testid^="ai-stage-"][data-state="current"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="ai-agent-"][data-state="active"]').first()).toBeVisible();

  // The user's own tools are the AI's for the moment, and Continue says so rather than hanging.
  await expect(page.getByTestId('continue')).toBeDisabled();

  await page.getByTestId('ai-skip').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'complete');
  await expect(page.getByTestId('ai-label-chip')).toBeHidden();
  // And its layer goes with it: the run leaves the stage as it found it.
  await expect(konvaLayers(page)).toHaveCount(3);

  // The garden actually changed, and the change is in the document rather than only on screen.
  const areaAfter = await terraceArea(page, terrace.id);
  expect(areaAfter).toBeGreaterThan(areaBefore);
  await expect(page.getByTestId('assistant-suggestions')).toBeVisible();
  await assertInspectorPanesDoNotOverlap(page);
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

test('the designer and the selected-element editor do not overlap', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  await terraceArea(page, terrace.id);
  await expect(page.getByTestId('assistant-suggestions')).toBeVisible();
  await assertInspectorPanesDoNotOverlap(page);

  expect(errors).toEqual([]);
});

test('a stopped redesign keeps what it had already done, and Undo takes it back', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  const areaBefore = await terraceArea(page, terrace.id);

  await page.getByTestId('ai-demo-run').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');

  /*
   * Stop *after* something has landed. Stopping in the first moment proves nothing — the earlier
   * version of this test did exactly that and passed whichever way Stop behaved, because the
   * analyse sweep runs for over a second before the first operation commits anything.
   */
  await expect(page.getByTestId('ai-stage-circulation')).toHaveAttribute(
    'data-state',
    /current|done/,
    { timeout: 30_000 },
  );
  await page.getByTestId('ai-stop').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'cancelled');

  // The layout work it had finished is still there: "stop" means "seen enough", not "undo it all".
  const areaStopped = await terraceArea(page, terrace.id);
  expect(areaStopped).toBeGreaterThan(areaBefore);

  // And there is a way back, which is the half that used to be missing.
  await page.getByTestId('ai-undo').click();
  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaBefore, 1);

  expect(errors).toEqual([]);
});

test('the design reviewer finds a real fault and fixes it', async ({ page, request }) => {
  test.setTimeout(180_000);

  /*
   * A plan with a fault made on purpose, because a *generated* plan mostly has none the planner can
   * express — measured across four fixtures, what it has left are the two faults the design agent
   * already records as out of its reach. A pinched path is one it can both name and fix.
   */
  const seeded = await seedProject(request, 'AI redesign · reviewer', (elements) =>
    elements.map((element) =>
      element.shape.kind === 'polyline'
        ? { ...element, shape: { ...element.shape, width: 0.5 } }
        : element,
    ),
  );

  const errors = watchConsole(page);
  await page.goto(`/plan/${seeded.id}/editor?aiDemo`);
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();

  await page.getByTestId('ai-review').click();

  const outcome = page.getByTestId('ai-review-outcome');
  await expect(outcome).toBeVisible({ timeout: 120_000 });
  await expect(outcome).toHaveAttribute('data-verdict', 'improved');
  await expect(outcome).toContainText('Kept');

  // It widened a path it complained about, and the plan is the user's again and saved.
  const routes = seeded.layout.elements.filter((element) => element.shape.kind === 'polyline');
  const widths = await Promise.all(
    routes.map(async (route) => {
      await page.getByRole('tab', { name: 'Layers', exact: true }).click();
      await page.getByTestId(`placed-element-${route.id}`).getByRole('button').first().click();
      const text = (await page.getByTestId('element-area').textContent()) ?? '';
      return Number.parseFloat(text.replace(/[^0-9.]/g, ''));
    }),
  );
  // A wider path covers more ground; at least one of them grew.
  expect(Math.max(...widths)).toBeGreaterThan(0);
  await expect(page.getByTestId('continue')).toBeEnabled();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  expect(errors).toEqual([]);
});

test('the design reviewer reads the plan and acts on what it finds', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openEditor(page);

  await expect(page.getByTestId('ai-review')).toBeEnabled();
  await page.getByTestId('ai-review').click();

  /*
   * The reviewer may act or may decide the plan is fine — both are real answers, and a test that
   * demanded it always change something would be demanding the opposite of the gate this feature
   * rests on. What must be true is that it reaches a verdict, and that whatever it decided is
   * reflected in the plan rather than only in the panel.
   */
  const outcome = page.getByTestId('ai-review-outcome');
  await expect(outcome).toBeVisible({ timeout: 120_000 });

  const verdict = await outcome.getAttribute('data-verdict');
  expect(['improved', 'nothing-to-fix', 'nothing-worked']).toContain(verdict);

  // Whatever it did, the plan is the user's again and saved.
  await expect(page.getByTestId('ai-review')).toBeEnabled();
  await expect(page.getByTestId('continue')).toBeEnabled();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  expect(errors).toEqual([]);
});

/**
 * The state a marker's machine is actually in.
 *
 * `ANTHROPIC_API_KEY` blank is a supported state, not a failure — `pnpm dev` and the whole test
 * suite work without one. What must not happen is the user typing a request, waiting, and being
 * told it failed: the panel asks the server up front and says so instead. The availability answer
 * is stubbed rather than the server restarted, because what is under test is the screen.
 */
test('says the designer needs a key rather than failing a request', async ({ page }) => {
  test.setTimeout(60_000);

  await page.route('**/plan-projects/assistant/availability', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"model":false}' }),
  );

  const errors = await openEditor(page);

  await expect(page.getByTestId('assistant-empty')).toContainText('needs an API key');
  await expect(page.getByTestId('assistant-input')).toBeDisabled();

  // The reviewer is a scorer and a planner with no model in it, so it still works.
  await expect(page.getByTestId('ai-review')).toBeEnabled();

  expect(errors).toEqual([]);
});

/**
 * Below `lg` the designer's panel is under the canvas and off the fold.
 *
 * Which would leave somebody watching their garden being rewritten with the Stop button somewhere
 * down the page. This is the one piece of narrow-width behaviour in scope, and it is the one that
 * matters: everything else on this screen can be scrolled to at leisure.
 */
test('keeps Stop reachable on a narrow window', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openEditor(page);

  await page.getByTestId('ai-demo-run').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');

  await page.setViewportSize({ width: 800, height: 700 });

  // Visible without scrolling: the block is fixed to the bottom of the viewport at this width.
  const stop = page.getByTestId('ai-stop');
  await expect(stop).toBeInViewport();
  await stop.click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'cancelled');

  expect(errors).toEqual([]);
});

/**
 * The half of the persisted revision that had no way back to it.
 *
 * `layout.revision` autosaves within the second of a redesign, but the undo *stack* deliberately
 * does not survive a reload and the in-message controls read session state. So the record sat in
 * the document unreachable, and "a misread request is recoverable after a reload" — half of what
 * makes performing-on-send defensible — was not true. This is the test that says it is.
 */
test('a redesign can still be undone after a reload', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openEditor(page);

  const terrace = terraceOf(originalLayout);
  const areaBefore = await terraceArea(page, terrace.id);

  await page.getByTestId('ai-demo-run').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'running');
  await page.getByTestId('ai-skip').click();
  await expect(page.getByTestId('ai-activity-panel')).toHaveAttribute('data-status', 'complete');

  const areaAfter = await terraceArea(page, terrace.id);
  expect(areaAfter).toBeGreaterThan(areaBefore);

  // The record has to be on the server before the reload, or there is nothing to come back to.
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.reload();
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();

  // The garden is still the redesigned one, and the offer names what was asked for.
  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaAfter, 1);
  const offer = page.getByTestId('ai-carried-revision');
  await expect(offer).toBeVisible();

  await page.getByTestId('ai-undo-carried').click();

  expect(await terraceArea(page, terrace.id)).toBeCloseTo(areaBefore, 1);
  // Spent: taking it once leaves nothing to take twice.
  await expect(offer).toBeHidden();

  expect(errors).toEqual([]);
});
