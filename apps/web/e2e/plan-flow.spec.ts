import { expect, test, type Page } from '@playwright/test';

/**
 * These tests need the whole stack, because persistence is the point:
 *   docker compose up -d && pnpm --filter @garden-studio/api dev
 *
 * The reload test below is the single most valuable assertion in the suite. Everything else about
 * the wizard can be checked in a unit test; "the garden is still there tomorrow" can only be
 * checked by drawing one, throwing the page away, and looking again.
 */

/**
 * Clicks the plan at an offset from the canvas's top-left corner, in pixels.
 *
 * Waits for the Konva `<canvas>` itself rather than the wrapper: the wrapper carries the test id
 * (Konva's `Stage` does not forward one) and exists before the stage has been measured and
 * mounted, so clicking on the strength of the wrapper alone lands on nothing.
 */
async function clickPlan(page: Page, offsetX: number, offsetY: number) {
  const wrapper = page.getByTestId('boundary-canvas');
  await wrapper.locator('canvas').first().waitFor();

  const box = await wrapper.boundingBox();
  if (!box) throw new Error('The boundary canvas has no bounding box.');

  await page.mouse.click(box.x + offsetX, box.y + offsetY);
}

/** Draws a four-corner plot and closes it. */
async function drawBoundary(page: Page) {
  await clickPlan(page, 160, 120);
  await clickPlan(page, 420, 120);
  await clickPlan(page, 420, 340);
  await clickPlan(page, 160, 340);

  /*
   * The explicit button, not a fifth click on the first corner: that click would land on the
   * corner's own drag handle, which stops the event before the stage sees it.
   */
  await page.getByTestId('close-shape').click();
}

test('the homepage starts a new plan at the mapping step', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Garden Studio' })).toBeVisible();

  await page.getByTestId('start-planning').click();

  // `/plan` creates a project and redirects into it, so the URL carries its id.
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/map$/);
  await expect(page.getByRole('heading', { name: 'Mapping setup' })).toBeVisible();
});

test('a drawn boundary survives a reload', async ({ page }) => {
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/map$/);
  const planUrl = page.url();

  await drawBoundary(page);

  const corners = page.locator('[data-testid^="vertex-"]');
  await expect(corners).toHaveCount(4);
  // Closing the ring retires its own button, which is how we know the plot is enclosed.
  await expect(page.getByTestId('close-shape')).toHaveCount(0);

  // Autosave is debounced, so wait for the bar to say it landed rather than guessing at a delay.
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  // The actual test: throw the page away and come back to the same URL.
  await page.goto('about:blank');
  await page.goto(planUrl);

  await expect(page.locator('[data-testid^="vertex-"]')).toHaveCount(4);
  await expect(page.getByTestId('close-shape')).toHaveCount(0);
});

/**
 * The route most users will take, end to end.
 *
 * Worth its own spec rather than folding into the one above: the preset path never touches the
 * canvas at all, so every assertion here would still pass if the drawing tools were broken — and
 * every assertion above would still pass if the preset were. They are two different ways to
 * originate a plot and they persist through the same autosave.
 */
test('a plot started from the rectangle preset can be measured, and survives a reload', async ({
  page,
}) => {
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/map$/);
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();

  // The default is a real plot, not an empty grid: 12 x 8 m.
  await expect(page.getByTestId('plot-area')).toContainText('96');

  const width = page.getByTestId('plot-width');
  await width.fill('14');
  await width.blur();

  const depth = page.getByTestId('plot-depth');
  await depth.fill('9');
  await depth.blur();

  // The running total is the thing that made a mis-scaled plot visible, so assert on it.
  await expect(page.getByTestId('plot-area')).toContainText('126');
  await expect(page.locator('[data-testid^="vertex-"]')).toHaveCount(4);

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  await expect(page.getByTestId('plot-area')).toContainText('126');
  await expect(page.getByTestId('plot-width')).toHaveValue('14.0');
});

/**
 * Openings are the first thing attached to a *part* of the house rather than to the house, so the
 * thing worth proving end to end is that the attachment survives the round trip: a wall id written
 * into JSONB, read back, and still naming a wall that exists.
 */
test('a patio door added to the house survives a reload', async ({ page }) => {
  await page.goto('/plan');
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();

  // In house mode a plain click drops the default footprint where it lands.
  await clickPlan(page, 300, 200);

  // Offered, not applied — nothing is placed until the chip is taken.
  await expect(page.getByTestId('openings-count')).toHaveText('None yet');
  await page.getByTestId('suggest-patio-door').click();

  await expect(page.getByTestId('openings-count')).toContainText('1 placed');
  await expect(page.getByTestId('openings-count')).toContainText('1 onto the garden');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  // Back on the plan, the wall the door names still exists, so it still resolves.
  await page.getByTestId('canvas-mode-house').click();
  await expect(page.getByTestId('openings-count')).toContainText('1 placed');
});

test('an unknown plan id is a 404 rather than an empty wizard', async ({ page }) => {
  const response = await page.goto('/plan/11111111-2222-3333-4444-555555555555/map');

  expect(response?.status()).toBe(404);
});
