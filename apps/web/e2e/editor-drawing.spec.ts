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
 * Drawing and reshaping on the plan, in a real browser — the class of fault that only a browser
 * finds, because Konva's hit-testing decides it. The reference fixture is a 12.5 × 19 m plot with
 * the house across the bottom, its garden wall at y = 14.
 */

const api = 'http://localhost:3001';
let projectId: string;

test.use({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 2 });

test.beforeAll(async ({ request }) => {
  const document = readPlanDocument(JSON.parse(readFileSync(resolve('scripts/fixtures/reference.plan.json'), 'utf8')));
  const created = await request.post(`${api}/plan-projects`, { data: { name: 'Editor verification · drawing' } });
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

/** Where a point in metres is on the page, from the transform the canvas publishes. */
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

async function dragFromTo(page: Page, from: Point, to: Point) {
  const a = await screenAt(page, from);
  const b = await screenAt(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function stored(request: import('@playwright/test').APIRequestContext): Promise<DesignElement[]> {
  const project = PlanProjectSchema.parse(await (await request.get(`${api}/plan-projects/${projectId}`)).json());
  return project.document.layout.elements;
}

async function arm(page: Page, category: string, tool: 'rect' | 'polygon' | 'polyline') {
  await page.getByTestId('add-feature').click();
  await page.getByTestId(`add-${category}`).click();
  await page.getByTestId(`draw-tool-${tool}`).click();
}

test('surfaces are drawn, snapped to the house, reshaped corner by corner and freed from a rectangle', async ({
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

  // A terrace drawn corner by corner; the last two corners are aimed 10 cm short of the house wall.
  await arm(page, 'paved-area', 'polygon');
  for (const corner of [
    { x: 2, y: 11 },
    { x: 5, y: 11 },
    { x: 5, y: 13.9 },
    { x: 2, y: 13.9 },
  ]) {
    await clickAt(page, corner);
    // Each click lands as a corner — two quick clicks must not read as a double click and finish early.
    if (corner.x !== 2 || corner.y !== 13.9) {
      await expect(page.getByTestId('draw-tool-strip')).toBeVisible();
    }
  }
  await clickAt(page, { x: 2.1, y: 11.1 });
  await expect(page.getByTestId('draw-tool-strip')).toHaveCount(0);
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  let added = (await stored(request)).filter((element) => !before.has(element.id));
  const terrace = added.find((element) => element.shape.kind === 'polygon')!;
  expect(terrace, 'a polygon was drawn').toBeTruthy();
  expect(terrace.shape.kind === 'polygon' && terrace.shape.points).toHaveLength(4);
  // Flush against the wall, not ten centimetres short of it.
  const houseSide = terrace.shape.kind === 'polygon' ? terrace.shape.points.filter((point) => point.y > 13) : [];
  expect(houseSide.every((point) => Math.abs(point.y - 14) < 1e-6)).toBe(true);

  // A path, drawn along its line and finished.
  await arm(page, 'paved-area', 'polyline');
  await clickAt(page, { x: 9, y: 3 });
  await clickAt(page, { x: 9, y: 10 });
  await page.getByTestId('draw-finish').click();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  added = (await stored(request)).filter((element) => !before.has(element.id));
  const path = added.find((element) => element.shape.kind === 'polyline')!;
  expect(path.shape.kind === 'polyline' && path.shape.width).toBe(1);

  // The terrace's corners: open them, drag one, then try to fold the outline and be refused.
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${terrace.id}`).getByRole('button').first().click();
  await page.getByTestId('element-tab-shape').click();
  await page.getByTestId('edit-corners').click();
  /*
   * Grab the corner where it actually is — it snapped to a generated bed's edge when it was drawn —
   * and let go near a target. It lands within snapping reach of the target, not necessarily on it:
   * a corner of something already there may claim it, which is the point of snapping.
   */
  const corner = terrace.shape.kind === 'polygon' ? terrace.shape.points[0]! : { x: 0, y: 0 };
  const target = { x: corner.x - 0.6, y: corner.y - 0.6 };
  await dragFromTo(page, corner, target);
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  let reshaped = (await stored(request)).find((element) => element.id === terrace.id)!;
  const moved = reshaped.shape.kind === 'polygon' ? reshaped.shape.points[0]! : corner;
  expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(0.35);
  expect(reshaped.shape.kind === 'polygon' && reshaped.shape.points).toHaveLength(4);

  await dragFromTo(page, moved, { x: 7, y: 12 });
  await expect(page.getByTestId('editor-clash')).toContainText('cross itself');
  await page.getByTestId('edit-corners').click();

  // A lawn dragged out as a rectangle, then freed into a polygon with the same corners.
  await arm(page, 'lawn', 'rect');
  await dragFromTo(page, { x: 7, y: 11 }, { x: 10.5, y: 13 });
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  added = (await stored(request)).filter((element) => !before.has(element.id));
  const lawn = added.find((element) => element.category === 'lawn')!;
  expect(lawn.shape.kind).toBe('rect');
  expect(lawn.shape.kind === 'rect' && lawn.shape.width).toBeGreaterThan(3);

  await page.getByTestId('element-tab-shape').click();
  await page.getByTestId('convert-to-free-shape').click();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  reshaped = (await stored(request)).find((element) => element.id === lawn.id)!;
  expect(reshaped.shape.kind === 'polygon' && reshaped.shape.points).toHaveLength(4);

  // Two paved things selected together, re-materialised in one go, and put back with one undo.
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByTestId(`placed-element-${terrace.id}`).getByRole('button').first().click();
  await page.getByTestId(`placed-element-${path.id}`).getByRole('button').first().click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('selection-header')).toContainText('2 selected');
  await page.getByTestId('selection-material').selectOption('porcelain');
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  let both = (await stored(request)).filter((element) => element.id === terrace.id || element.id === path.id);
  expect(both.map((element) => element.material)).toEqual(['porcelain', 'porcelain']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  both = (await stored(request)).filter((element) => element.id === terrace.id || element.id === path.id);
  expect(both.some((element) => element.material === 'porcelain')).toBe(false);

  // A Shift-drag on bare canvas sweeps a selection.
  await page.keyboard.press('Escape');
  // From two metres outside the fence, on bare canvas: a tree's canopy may reach over the fence.
  const sweepFrom = await screenAt(page, { x: -2, y: 9.8 });
  const sweepTo = await screenAt(page, { x: 5.5, y: 13.6 });
  await page.keyboard.down('Shift');
  await page.mouse.move(sweepFrom.x, sweepFrom.y);
  await page.mouse.down();
  await page.mouse.move(sweepTo.x, sweepTo.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('selection-header')).toBeVisible();

  // Locked, the terrace holds still: its Shape tab goes and a drag across it moves nothing.
  await page.keyboard.press('Escape');
  await page.getByTestId(`toggle-lock-${terrace.id}`).click();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  const held = (await stored(request)).find((element) => element.id === terrace.id)!;
  expect(held.locked).toBe(true);
  await dragFromTo(page, { x: 3, y: 12.5 }, { x: 4, y: 11.5 });
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  expect((await stored(request)).find((element) => element.id === terrace.id)!.shape).toEqual(held.shape);

  expect(errors).toEqual([]);
});
