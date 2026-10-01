import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  GenerateConceptsResultSchema,
  PlanProjectSchema,
  readPlanDocument,
  SectionPatchResultSchema,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';

/**
 * Plants, planting mixes and proposed boundaries, in a real browser: a species placed from the
 * palette, a bed given a mix with its counts and its light verdict, a screen drawn onto the fence
 * line, and what the review screen then orders. The reference fixture is a 12.5 × 19 m plot in
 * Liverpool with the house across the bottom, so it has a location and the light can be judged.
 */

const api = 'http://localhost:3001';
let projectId: string;

test.use({ viewport: { width: 1536, height: 1024 } });

test.beforeAll(async ({ request }) => {
  const document = readPlanDocument(JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')));
  const created = await request.post(`${api}/plan-projects`, { data: { name: 'Editor verification · planting' } });
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
  project = SectionPatchResultSchema.parse(await selected.json()).project;
  const layout = { elements: chosen.elements, seededFrom: chosen.id, pristine: chosen.elements };
  const saved = await request.patch(`${api}/plan-projects/${projectId}/layout`, { data: { revision: project.revision, section: layout } });
  expect(saved.ok()).toBe(true);
});

async function screenAt(page: Page, point: Point): Promise<Point> {
  const canvas = page.getByTestId('editor-canvas');
  const scale = Number(await canvas.getAttribute('data-scale'));
  const offsetX = Number(await canvas.getAttribute('data-offset-x'));
  const offsetY = Number(await canvas.getAttribute('data-offset-y'));
  const stage = (await canvas.locator('.konvajs-content').boundingBox())!;
  return { x: stage.x + offsetX + point.x * scale, y: stage.y + offsetY + point.y * scale };
}

async function clickAt(page: Page, point: Point) {
  const at = await screenAt(page, point);
  await page.mouse.click(at.x, at.y);
}

async function stored(request: import('@playwright/test').APIRequestContext): Promise<DesignElement[]> {
  const project = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  return project.document.layout.elements;
}

async function saved(page: Page) {
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
}

test('plants a species, gives a bed a mix, screens the fence, and the review orders all three', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`/plan/${projectId}/editor`);
  await expect(page.getByTestId('editor-concept-name')).toBeVisible();
  await page.getByTestId('editor-canvas').locator('canvas').first().waitFor();
  const before = new Set((await stored(request)).map((element) => element.id));

  // A hornbeam, from the Plants group, placed where the plan is clicked.
  await page.getByRole('tab', { name: 'Add to garden', exact: true }).click();
  await page.getByTestId('palette-group-plants').click();
  await page.getByTestId('palette-carpinus-betulus-fastigiata').click();
  await clickAt(page, { x: 6.2, y: 4.5 });
  await saved(page);
  let added = (await stored(request)).filter((element) => !before.has(element.id));
  const hornbeam = added.find((element) => element.plantId === 'carpinus-betulus-fastigiata');
  expect(hornbeam, 'a hornbeam was placed').toBeTruthy();
  expect(hornbeam!.shape).toMatchObject({ kind: 'point', radius: 2 });

  // A generated bed, given the shade mix: counts to order and a verdict on its light.
  const bed = (await stored(request)).find(
    (element) => element.category === 'planting-bed' && element.shape.kind === 'polygon' && element.fillKind !== 'base',
  )!;
  expect(bed, 'the concept has a bed').toBeTruthy();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${bed.id}`).getByRole('button').first().click();
  await page.getByTestId('element-tab-planting').click();
  await page.getByTestId('planting-mix').selectOption('mix-shade-woodland');
  await saved(page);
  await expect(page.getByTestId('planting-line-dryopteris-filix-mas')).toBeVisible();
  await expect(page.getByTestId('planting-total')).toContainText('to order');
  await expect(page.getByTestId('planting-light')).toBeVisible();
  expect((await stored(request)).find((element) => element.id === bed.id)?.material).toBe('mix-shade-woodland');

  // A slatted screen drawn along the left fence, snapped onto its line.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Add to garden', exact: true }).click();
  await page.getByTestId('palette-group-boundaries').click();
  await page.getByTestId('palette-enclosure-screen').click();
  await expect(page.getByTestId('draw-tool-polyline')).toBeVisible();
  await clickAt(page, { x: 0.05, y: 3 });
  await clickAt(page, { x: 0.05, y: 9 });
  await page.getByTestId('draw-finish').click();
  await saved(page);
  added = (await stored(request)).filter((element) => !before.has(element.id));
  const screen = added.find((element) => element.category === 'enclosure')!;
  expect(screen, 'a screen was drawn').toBeTruthy();
  expect(screen).toMatchObject({ material: 'slatted-screen', enclosure: { kind: 'screen' } });
  const points = screen.shape.kind === 'polyline' ? screen.shape.points : [];
  expect(points.every((point) => Math.abs(point.x) < 0.05)).toBe(true);

  // The review orders what was specified: the hornbeam, the shade mix's plants and the screen.
  await page.goto(`/plan/${projectId}/review`);
  const takeoff = page.getByTestId('takeoff');
  await expect(takeoff).toContainText('Upright hornbeam');
  await expect(takeoff).toContainText('Male fern');
  await expect(takeoff).toContainText('Screen — Slatted cedar screen');
  await expect(page.getByTestId('schedule-mix-shade-woodland')).toContainText('plants');

  // And it all comes back after a reload.
  await page.goto(`/plan/${projectId}/editor`);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(page.getByTestId(`placed-element-${screen.id}`)).toBeVisible();
  await expect(page.getByTestId(`placed-element-${hornbeam!.id}`)).toBeVisible();

  expect(errors).toEqual([]);
});
