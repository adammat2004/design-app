import { createCanvas } from '@napi-rs/canvas';
import { expect, test, type Page } from '@playwright/test';

/**
 * The aerial path, end to end, with every outside service stubbed at the network: the imagery
 * configuration, the geocoder and the tiles themselves. The API and the database are real, so
 * what is exercised is the whole chain from "Find my property" to a stored, reloadable plan.
 *
 * Run at a device pixel ratio of 2 on purpose. Anything that depends on it has to be tested at a
 * value other than 1, because 1 is the value that hides the bug — and a headless browser's
 * default.
 */
test.use({ deviceScaleFactor: 2 });

/**
 * A green checkerboard tile, drawn rather than pasted: a hand-typed PNG that does not decode
 * fails silently in the browser (the tile cache treats a bad tile as a hole, not an error),
 * which cost an afternoon. The test never looks at pixels; it only needs bytes that decode.
 */
const TILE_PNG = (() => {
  const canvas = createCanvas(256, 256);
  const context = canvas.getContext('2d');
  context.fillStyle = '#6b8f4e';
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = '#4a6b35';
  context.fillRect(0, 0, 128, 128);
  context.fillRect(128, 128, 128, 128);
  return canvas.toBuffer('image/png');
})();

const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };

async function stubAerialServices(page: Page) {
  await page.route('**/imagery/config', (route) =>
    route.fulfill({
      json: {
        provider: 'stub',
        tileTemplate: '/imagery/tiles/{z}/{x}/{y}',
        retinaTemplate: '/imagery/tiles/{z}/{x}/{y}@2x',
        delivery: 'proxy',
        attribution: 'Imagery © Stub',
        minZoom: 0,
        maxZoom: 19,
        tileSize: 256,
      },
    }),
  );
  await page.route('**/imagery/tiles/**', (route) =>
    route.fulfill({ body: TILE_PNG, contentType: 'image/png' }),
  );
  await page.route('**/geocode', (route) =>
    route.fulfill({
      json: {
        results: [
          { label: '1 Example Road, Dublin', location: DUBLIN, precision: 'rooftop' },
          { label: 'Example Road, Dublin', location: DUBLIN, precision: 'street' },
        ],
      },
    }),
  );
}

async function clickPlan(page: Page, offsetX: number, offsetY: number) {
  // The wrapper carries the test id; the stage inside it is what has to exist before a click.
  const canvas = page.getByTestId('boundary-canvas').locator('canvas').first();
  await canvas.waitFor();
  const box = await page.getByTestId('boundary-canvas').boundingBox();
  if (!box) throw new Error('The canvas has no size.');
  await page.mouse.click(box.x + offsetX, box.y + offsetY);
}

test('a garden can be traced over stubbed imagery and comes back on reload', async ({ page }) => {
  await stubAerialServices(page);
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/map$/);

  // The choice is offered, and aerial is enabled because the (stubbed) server has imagery.
  await expect(page.getByTestId('method-aerial')).toBeEnabled();
  await page.getByTestId('method-aerial').click();

  await page.getByTestId('address-query').fill('1 Example Road');
  await page.getByTestId('address-submit').click();
  await page.getByTestId('address-result-0').click();

  // Imagery arrives under the canvas, with the provider credited.
  const status = page.getByTestId('imagery-status');
  await expect(status).toHaveAttribute('data-visible', 'true');
  await expect(status).toContainText('Imagery © Stub');
  await expect
    .poll(async () => Number(await status.getAttribute('data-loaded')), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const wanted = Number(await status.getAttribute('data-total'));
  await expect.poll(async () => Number(await status.getAttribute('data-loaded'))).toBe(wanted);

  // Trace four corners. The first one pins the plan to the photograph.
  // Well inside the canvas, which is only 420 px tall in a headless viewport.
  await clickPlan(page, 200, 120);
  await expect(page.getByTestId('address-located')).toBeVisible();
  await clickPlan(page, 480, 130);
  await clickPlan(page, 470, 330);
  await clickPlan(page, 190, 320);
  await page.getByTestId('close-shape').click();

  // The traced sides are estimates until checked, and the checklist says so.
  await expect(page.getByTestId('sub-step-boundary')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('sub-step-measurements')).toHaveAttribute('data-done', 'false');
  // Closing the outline hands the user to house placement; the row brings the sides back.
  await page.getByTestId('sub-step-measurements').click();
  await expect(page.getByTestId('side-lengths-estimate-note')).toBeVisible();
  await expect(page.getByTestId('side-confirm-0')).toBeVisible();
  await page.getByTestId('side-confirm-0').click();
  await expect(page.getByTestId('side-checked-0')).toBeVisible();

  const area = await page.getByTestId('plot-area').textContent();

  // Everything survives a reload: the outline, the pin, the imagery, and the snaps stay off.
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();

  await expect(page.getByTestId('address-located')).toBeVisible();
  await expect(page.getByTestId('plot-area')).toHaveText(area ?? '');
  await expect(page.getByTestId('imagery-status')).toHaveAttribute('data-visible', 'true');
  await expect
    .poll(async () => Number(await page.getByTestId('imagery-status').getAttribute('data-loaded')))
    .toBeGreaterThan(0);

  // The photograph can be hidden and the plan is still there.
  await page.getByTestId('imagery-toggle').click();
  await expect(page.getByTestId('imagery-status')).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('sub-step-boundary')).toHaveAttribute('data-done', 'true');
});

test('without imagery on the server the aerial option is offered but disabled', async ({ page }) => {
  await page.route('**/imagery/config', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/plan');

  await expect(page.getByTestId('method-aerial')).toBeDisabled();
  await expect(page.getByTestId('method-aerial')).toContainText('not set up');

  // The measured path is exactly what it was.
  await page.getByTestId('method-manual').click();
  await expect(page.getByTestId('plot-shape-picker')).toBeVisible();
});
