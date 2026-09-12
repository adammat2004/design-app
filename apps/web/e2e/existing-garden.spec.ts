import { expect, test, type Page } from '@playwright/test';

/**
 * Step 2, end to end.
 *
 * Needs the whole stack, because persistence is the point:
 *   docker compose up -d && pnpm --filter @garden-studio/api dev
 *
 * The screen has three equally valid routes through it — map the few things that matter, describe
 * the garden and have them mapped for you, or map nothing at all — and the third is the one a unit
 * test cannot really check, because "skipping is a first-class path" means it has to navigate and
 * persist like any other answer.
 *
 * The assistant route is deliberately not exercised here: it needs an Anthropic key, and the whole
 * feature is built so that a marker without one still gets a working screen. `503` and "you can
 * still add features by hand" is the tested path, in `garden-assistant-store.test.ts`.
 */

/** Clicks a canvas at an offset from its top-left corner, in pixels. */
async function clickCanvas(page: Page, testId: string, offsetX: number, offsetY: number) {
  const wrapper = page.getByTestId(testId);
  // Konva's Stage does not forward a test id, so the wrapper exists before the stage is mounted.
  await wrapper.locator('canvas').first().waitFor();

  const box = await wrapper.boundingBox();
  if (!box) throw new Error(`${testId} has no bounding box.`);

  await page.mouse.click(box.x + offsetX, box.y + offsetY);
}

/** Step 1: a rectangle preset and a house, which is everything step 2 needs. */
async function mapProperty(page: Page): Promise<string> {
  await page.goto('/plan');
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();

  // In house mode a plain click drops the default footprint where it lands.
  await clickCanvas(page, 'boundary-canvas', 300, 200);

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  await page.getByTestId('continue').click();
  await expect(page).toHaveURL(/\/features$/);

  return planUrl;
}

test('a tree placed with two taps survives a reload', async ({ page }) => {
  const planUrl = await mapProperty(page);

  await expect(page.getByRole('heading', { name: 'Existing garden' })).toBeVisible();
  await expect(page.getByTestId('placed-features-empty')).toBeVisible();

  // The whole point of the quick-add path: arm, tap, done. No form in between.
  await page.getByTestId('palette-tree').click();
  await clickCanvas(page, 'features-canvas', 260, 300);

  await expect(page.getByTestId('placed-features').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('feature-summary')).toContainText('1 feature placed');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(`${planUrl.replace(/\/map$/, '')}/features`);

  await expect(page.getByTestId('placed-features').locator('li')).toHaveCount(1);
});

/**
 * Skipping is a real answer, not an error state.
 *
 * It has to navigate, it has to persist, and it must not invent anything — so the assertion is on
 * all three: we land on the brief, and coming back finds the garden still empty.
 */
test('skipping the step continues cleanly and creates nothing', async ({ page }) => {
  const planUrl = await mapProperty(page);

  await page.getByTestId('secondary-action').click();
  await expect(page).toHaveURL(/\/brief$/);

  await page.goto('about:blank');
  await page.goto(`${planUrl.replace(/\/map$/, '')}/features`);

  await expect(page.getByTestId('placed-features-empty')).toBeVisible();
});

test('Continue is never blocked by an empty garden', async ({ page }) => {
  await mapProperty(page);

  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
  await expect(page).toHaveURL(/\/brief$/);
});

/**
 * The redesign area, drawn and persisted.
 *
 * This is the half of the screen the generator reads most strictly — everything outside the outline
 * is left alone — so "it came back after a reload" is the assertion that matters. The `Clear` button
 * only exists once an outline is stored, which is what makes it a usable probe for that.
 */
test('a custom redesign area is drawn, persisted and clearable', async ({ page }) => {
  const planUrl = await mapProperty(page);

  await page.getByTestId('tab-area').click();
  await expect(page.getByTestId('clear-scope')).toHaveCount(0);

  await page.getByTestId('draw-scope').click();

  /*
   * Well inside the 12 x 8 m preset. Worth saying why: an outline that strays over the fence is
   * refused outright — `scopeRing` is the single rule — and the first draft of this test drew one
   * that did, which read as the tool being broken rather than the tool working.
   */
  await clickCanvas(page, 'features-canvas', 240, 240);
  await clickCanvas(page, 'features-canvas', 400, 240);
  await clickCanvas(page, 'features-canvas', 400, 330);
  await clickCanvas(page, 'features-canvas', 240, 330);

  // The explicit button rather than a fifth click on the first corner, for the reason step 1's
  // `close-shape` exists: that click lands on the corner's own handle in a real browser.
  await page.getByTestId('finish-feature').click();

  await expect(page.getByTestId('clear-scope')).toBeVisible();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(`${planUrl.replace(/\/map$/, '')}/features`);

  await page.getByTestId('tab-area').click();
  await expect(page.getByTestId('clear-scope')).toBeVisible();

  await page.getByTestId('clear-scope').click();
  await expect(page.getByTestId('clear-scope')).toHaveCount(0);
});
