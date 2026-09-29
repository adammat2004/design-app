import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  boundaryPolygon,
  elementIsLegal,
  elementOutline,
  GenerateConceptsResultSchema,
  housePolygon,
  planStructureResize,
  PlanProjectSchema,
  polygonCentroid,
  readPlanDocument,
  SectionPatchResultSchema,
  standsInside,
  type DesignElement,
  type PlanDocument,
} from '@garden-studio/schema';

const output = resolve('.plan-preview');
let projectId: string;
let originalLayout: PlanDocument['layout'];
const api = 'http://localhost:3001';

test.use({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 2 });

test.beforeAll(async ({ request }) => {
  mkdirSync(output, { recursive: true });
  const document = readPlanDocument(JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')));
  const created = await request.post(`${api}/plan-projects`, { data: { name: 'Editor verification · composed landscape' } });
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
  const selected = await request.patch(`${api}/plan-projects/${projectId}/concept-selection`, { data: {
    revision: project.revision, selectedId: chosen.id, chosenConceptId: chosen.id,
  } });
  expect(selected.ok()).toBe(true);
  project = SectionPatchResultSchema.parse(await selected.json()).project;
  const layout = { elements: chosen.elements, seededFrom: chosen.id, pristine: chosen.elements };
  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, { data: { revision: project.revision, section: layout } });
  expect(saved.ok()).toBe(true);
  const savedResult = SectionPatchResultSchema.parse(await saved.json());
  expect(savedResult.violations).toEqual([]);
  originalLayout = savedResult.project.document.layout;
  writeFileSync(resolve(output, 'browser-project.json'), JSON.stringify({ projectId, url: `http://localhost:3000/plan/${projectId}/editor` }, null, 2));
});

test('the 2D plan renders at DPR 2, draws the plan camera, and an edit survives a reload', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/plan/${projectId}/editor?renderer=v2&renderDiagnostics`);
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  // Make a real user edit; it must survive the export and a reload.
  const terrace = originalLayout.elements.find((element) => element.category === 'paved-area' && element.role === 'feature' && element.shape.kind === 'rect')!;
  expect(terrace).toBeTruthy();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${terrace.id}`).getByRole('button').first().click();
  await page.getByTestId('element-name').fill('Family terrace');
  await page.getByTestId('element-name').blur();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  // The existing editor resolves bed membership on its first edit. Take the saved baseline
  // after that explicit edit, then require the export and the reload to leave it untouched.
  const baseline = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json()).document;
  const edited = baseline.layout;
  expect(edited.elements.map(({ id, shape, category, material }) => ({ id, shape, category, material })))
    .toEqual(originalLayout.elements.map(({ id, shape, category, material }) => ({ id, shape, category, material })));
  expect(edited.elements.find((element) => element.id === terrace.id)?.name).toBe('Family terrace');
  originalLayout = edited;
  await page.screenshot({ path: resolve(output, 'browser-editor.png') });

  /*
   * The 2D Plan's stack is **plants and nothing else**.
   *
   * It once built an elevated scene — lifted extrusions, skinned faces, the oblique stack — on the
   * tab whose whole job is the flat diagram, and every unit test passed because the fault was the
   * caller asking for the wrong thing. That view is gone, and this is the browser-level guard that
   * nothing standing but planting reaches the plan's stack.
   */
  const planScene = page.getByTestId('editor-scene');
  const planPlants = Number(await planScene.getAttribute('data-plants'));
  expect(planPlants).toBeGreaterThan(0);
  await expect(planScene).toHaveAttribute('data-stack', String(planPlants));

  const downloadEvent = page.waitForEvent('download');
  await page.getByText('Edit actions', { exact: true }).click();
  await page.getByTestId('download-plan').click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  await download.saveAs(resolve(output, 'browser-export.png'));

  const persisted = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  expect(persisted.document.layout).toEqual(originalLayout);
  expect(JSON.stringify(persisted.document)).toBe(JSON.stringify(baseline));
  await page.reload();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(page.getByTestId(`placed-element-${terrace.id}`)).toContainText('Family terrace');
  expect(errors).toEqual([]);
});

/**
 * The 3D editor edits the plan's own element: a width typed there is the footprint on the plan, the
 * turn the plan gave it is kept, and what is configured is saved with the plan.
 */
test('a pergola opens in 3D, and what is changed there is the plan', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const project = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  const { site, layout } = project.document;
  const boundary = boundaryPolygon(site);
  const xs = boundary.map((point) => point.x);
  const ys = boundary.map((point) => point.y);
  const pergolaAt = (centre: { x: number; y: number }): DesignElement => ({
    id: 'e-9001',
    category: 'structure',
    role: 'feature',
    name: 'Test pergola',
    symbol: 'pergola',
    material: 'hardwood',
    height: 2.4,
    zone: 'back',
    shape: { kind: 'rect', centre, width: 3, depth: 3, rotation: 25 },
  });
  /*
   * Somewhere the 3 → 4 m resize below is clean. A resize keeps whatever edge the pergola is against
   * and refuses one that runs into a bed, so this asks the same rule the editor uses rather than
   * hoping the middle of the plot is open lawn — and the assertion at the end is that rule's answer.
   */
  const context = { elements: layout.elements, boundary, house: site.house ? housePolygon(site.house) : null };
  const candidates = [
    { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
    ...layout.elements
      .filter((element) => element.category === 'lawn' || element.category === 'paved-area')
      .map((element) => polygonCentroid(elementOutline(element))),
  ];
  const clean = candidates
    .map(pergolaAt)
    .map((candidate) => ({ candidate, resized: planStructureResize(candidate, { width: 4 }, context) }))
    .find(({ candidate, resized }) => elementIsLegal(candidate, boundary) && resized.status === 'ok');
  expect(clean, 'somewhere on the plan a 3 m pergola can become 4 m').toBeTruthy();
  const pergola = clean!.candidate;
  const expectedShape = clean!.resized.status === 'ok' ? clean!.resized.element.shape : null;
  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, {
    data: { revision: project.revision, section: { ...layout, elements: [...layout.elements, pergola] } },
  });
  expect(saved.ok()).toBe(true);

  await page.goto(`/plan/${projectId}/editor`);
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${pergola.id}`).getByRole('button').first().click();

  await page.getByTestId('edit-in-3d').click();
  await expect(page.getByTestId('structure-workspace')).toBeVisible();
  await expect(page.getByTestId('editor-catalogue')).toBeHidden();
  const viewport = page.getByTestId('structure-viewport');
  await expect(viewport.locator('canvas')).toHaveCount(1);
  await expect(viewport).toHaveAttribute('data-width', '3');
  // It opens among its surroundings — the garden's own ground around it — which can be switched off.
  await expect(viewport).toHaveAttribute('data-surroundings', 'on');
  expect(Number(await viewport.getAttribute('data-context-surfaces'))).toBeGreaterThan(0);
  await page.getByTestId('structure-surroundings').click();
  await expect(viewport).toHaveAttribute('data-surroundings', 'off');
  await expect(viewport).toHaveAttribute('data-context-surfaces', '0');
  await page.getByTestId('structure-surroundings').click();
  await expect(viewport).toHaveAttribute('data-surroundings', 'on');
  await expect(viewport.locator('canvas')).toHaveCount(1);

  // It opens on the look; the footprint is the last tab.
  await expect(page.getByTestId('structure-tab-style')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('structure-tab-size').click();
  const width = page.getByTestId('structure-width');
  await width.fill('4');
  await width.press('Tab');
  await expect(viewport).toHaveAttribute('data-width', '4');

  await page.getByTestId('structure-camera-front').click();
  await expect(viewport).toHaveAttribute('data-camera', 'front');
  await page.getByTestId('structure-tab-sides').click();
  await page.getByTestId('structure-side-left-slatted').click();

  // A part clicked in the view opens the tab that edits it, and the hint that said so goes.
  await expect(page.getByTestId('structure-hint')).toBeVisible();
  await page.getByTestId('structure-tab-roof').click();
  await page.getByTestId('structure-roof-kind-solid').click();
  await page.getByTestId('structure-tab-size').click();
  await page.getByTestId('structure-camera-top').click();
  await page.waitForTimeout(1200);
  const above = (await viewport.boundingBox())!;
  await page.mouse.click(above.x + above.width / 2 + 40, above.y + above.height / 2 + 30);
  await expect(page.getByTestId('structure-tab-roof')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('structure-hint')).toHaveCount(0);

  // Inside it: lay a floor, put a table in it, and carry the table across the floor in the view.
  await page.getByTestId('structure-tab-inside').click();
  await page.getByTestId('structure-floor-stone-setts').click();
  await expect(viewport).toHaveAttribute('data-floor', 'stone-setts');
  await page.getByTestId('structure-piece-add').selectOption('dining-set-4');
  await expect(viewport).toHaveAttribute('data-interior', '1');
  const pieceId = await viewport.getAttribute('data-piece');
  expect(pieceId).toBeTruthy();
  await page.getByTestId('structure-camera-top').click();
  await page.waitForTimeout(1200);
  const frame = (await viewport.boundingBox())!;
  const middle = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 120, middle.y + 20, { steps: 10 });
  await page.mouse.up();
  await page.getByTestId('structure-camera-orbit').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(output, 'browser-structure-editor.png') });

  await page.getByTestId('structure-done').click();
  await expect(page.getByTestId('structure-workspace')).toHaveCount(0);
  await expect(page.getByTestId('editor-catalogue')).toBeVisible();
  await page.getByTestId('element-tab-shape').click();
  await expect(page.getByTestId('element-width')).toHaveValue('4.0');
  await expect(page.getByTestId('element-rotation')).toHaveValue('25');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  const stored = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  const element = stored.document.layout.elements.find((candidate) => candidate.id === pergola.id)!;
  // Exactly what the resize rule said: 4 m wide, the turn kept, any edge it is against held.
  expect(element.shape).toEqual(expectedShape);
  expect(element.shape).toMatchObject({ width: 4, depth: 3, rotation: 25 });
  expect(element.structure).toEqual({ sides: { left: 'slatted' }, roof: { kind: 'solid' }, floor: 'stone-setts' });
  // The table is its own element, standing inside the pergola, and the drag moved it off-centre.
  const table = stored.document.layout.elements.find((candidate) => candidate.id === pieceId)!;
  expect(table).toMatchObject({ category: 'furniture', symbol: 'dining-set-4' });
  expect(standsInside(element, table)).toBe(true);
  expect(table.shape.kind === 'rect' && table.shape.centre).not.toEqual(element.shape.kind === 'rect' && element.shape.centre);
  expect(errors).toEqual([]);
});
