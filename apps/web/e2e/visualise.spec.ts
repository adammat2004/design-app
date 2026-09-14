import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { GenerateConceptsResultSchema, PlanProjectSchema, readPlanDocument, SectionPatchResultSchema, type PlanDocument } from '@garden-studio/schema';

const output = resolve('.plan-preview');
let projectId: string;
let originalLayout: PlanDocument['layout'];
const api = 'http://localhost:3001';

test.use({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 2 });

test.beforeAll(async ({ request }) => {
  mkdirSync(output, { recursive: true });
  const document = readPlanDocument(JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')));
  const created = await request.post(`${api}/plan-projects`, { data: { name: 'Visual verification · composed landscape' } });
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

test('Visualise renders at DPR 2, responds to maturity and camera controls, and preserves the design', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/plan/${projectId}/editor?renderer=v2&renderDiagnostics`);
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  // Make a real user edit before exercising presentation; it must survive both views and reload.
  const terrace = originalLayout.elements.find((element) => element.category === 'paved-area' && element.role === 'feature' && element.shape.kind === 'rect')!;
  expect(terrace).toBeTruthy();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${terrace.id}`).getByRole('button').first().click();
  await page.getByTestId('element-name').fill('Family terrace');
  await page.getByTestId('element-name').blur();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  // The existing editor resolves bed membership on its first edit. Take the saved baseline
  // after that explicit edit, then require all presentation actions to leave it untouched.
  const baseline = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json()).document;
  const edited = baseline.layout;
  expect(edited.elements.map(({ id, shape, category, material }) => ({ id, shape, category, material })))
    .toEqual(originalLayout.elements.map(({ id, shape, category, material }) => ({ id, shape, category, material })));
  expect(edited.elements.find((element) => element.id === terrace.id)?.name).toBe('Family terrace');
  originalLayout = edited;
  await page.screenshot({ path: resolve(output, 'browser-editor.png') });
  await page.getByTestId('view-visualise').click();
  const canvas = page.getByTestId('visualise-canvas');
  await expect(canvas).toHaveAttribute('data-scale', /\d/);
  await expect(page.getByTestId('visualise-failed')).toHaveCount(0);
  await expect(canvas.locator('canvas')).toHaveCount(2);
  await expect(page.getByTestId('editor-catalogue')).toBeHidden();
  await expect(page.getByTestId('editor-inspector')).toBeHidden();
  await expect(page.getByTestId('tool-select')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, 'browser-visualise.png') });
  const mature = Number(await canvas.getAttribute('data-plants'));
  await page.getByTestId('maturity-year-1').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-plants'))).toBeLessThan(mature);
  await page.getByTestId('maturity-mature').click();
  await expect(canvas).toHaveAttribute('data-plants', String(mature));
  const sunTime = page.getByTestId('sun-time');
  const initialTime = Number(await sunTime.inputValue());
  await sunTime.focus();
  await sunTime.press('ArrowRight');
  await expect(sunTime).toHaveValue(String(initialTime + 15));
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  const fitScale = Number(await canvas.getAttribute('data-scale'));
  await canvas.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(fitScale);
  const zoomScale = await canvas.getAttribute('data-scale');
  const centre = await canvas.getAttribute('data-centre');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-centre', centre!);
  const panned = await canvas.getAttribute('data-centre');
  await page.getByTestId('view-plan').click();
  await expect(page.getByTestId('editor-catalogue')).toBeVisible();
  await page.getByTestId('view-visualise').click();
  await expect(canvas).toHaveAttribute('data-scale', zoomScale!);
  await expect(canvas).toHaveAttribute('data-centre', panned!);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(Number(zoomScale));
  await expect(page.getByTestId('visualise-failed')).toHaveCount(0);

  await canvas.getByRole('button', { name: 'Fit plot', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'browser-plot.png') });
  await canvas.getByRole('button', { name: 'Fit garden', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-scale', fitScale.toFixed(3));
  const downloadEvent = page.waitForEvent('download');
  await page.getByTestId('visualise-panel').getByTestId('download-plan').click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  await download.saveAs(resolve(output, 'browser-export.png'));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeLessThan(fitScale);
  await page.screenshot({ path: resolve(output, 'browser-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Measure actual mobile-viewport camera updates, separately from the desktop fixture lab.
  const mobileBox = (await canvas.boundingBox())!;
  await page.mouse.move(mobileBox.x + mobileBox.width / 2, mobileBox.y + mobileBox.height / 2);
  await page.mouse.down();
  const mobileFrames: number[] = [];
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(mobileBox.x + mobileBox.width / 2 + i, mobileBox.y + mobileBox.height / 2);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const frame = JSON.parse((await canvas.locator('canvas').first().getAttribute('data-render-metrics'))!);
    expect(frame.surfacesRasterized).toBe(0); expect(frame.shadowsRasterized).toBe(0);
    mobileFrames.push(frame.frameMs);
  }
  await page.mouse.up();
  const mobileP95Ms = mobileFrames.sort((a, b) => a - b)[19]!;
  expect(mobileP95Ms).toBeLessThanOrEqual(33);
  writeFileSync(resolve(output, 'mobile-performance.json'), JSON.stringify({ mobileP95Ms, mobileFrames }, null, 2));
  const persisted = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  expect(persisted.document.layout).toEqual(originalLayout);
  expect(persisted.document.site.sun.minutes).toBe(initialTime);
  expect(JSON.stringify(persisted.document)).toBe(JSON.stringify(baseline));
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.reload();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(page.getByTestId(`placed-element-${terrace.id}`)).toContainText('Family terrace');
  await page.getByTestId('view-visualise').click();
  await expect(page.getByTestId('sun-time')).toHaveValue(String(initialTime));
  await expect(page.getByTestId('visualise-failed')).toHaveCount(0);
  // Losing WebGL must preserve the design through the shared Canvas2D compositor.
  await expect(canvas.locator('canvas').first()).toHaveAttribute('data-render-metrics', /revision/);
  await canvas.locator('canvas').first().evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new Error('Expected a live WebGL context before the fallback test');
    gl.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.getByTestId('visualise-fallback')).toHaveAttribute('data-revision', /\w/);
  await expect(page.getByTestId('visualise-failed')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, 'browser-canvas-fallback.png') });
  expect(errors).toEqual([]);
});
