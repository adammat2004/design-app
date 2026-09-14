import { expect, test, type Page } from '@playwright/test';

/**
 * Step 3, end to end.
 *
 * Needs the whole stack, because persistence is the point:
 *   docker compose up -d && pnpm --filter @garden-studio/api dev
 *
 * The screen is a grid of photographs now, and the risk that comes with that is specific: the
 * pictures could all be right and the *answers* silently wrong, because what the user touches is a
 * card rather than a control. So this checks the joins — a card's tick is a real checkbox, the
 * checkbox is what reaches the document, and the document is what comes back after a reload.
 *
 * The artwork itself is deliberately not asserted on. A missing file is a supported state
 * (`SpaceCard` falls back to a drawn placeholder), so a test that demanded an image would fail for
 * somebody who cloned the repository rather than for somebody who broke it.
 */

/** Step 1: a rectangle preset and a house, then straight through step 2. */
async function reachBrief(page: Page): Promise<string> {
  await page.goto('/plan');
  // `/plan` creates a plan and redirects into its first step, so this lands on `.../map`.
  const planUrl = page.url().replace(/\/map$/, '');

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();

  // Konva's Stage does not forward a test id, so the wrapper exists before the stage is mounted.
  const wrapper = page.getByTestId('boundary-canvas');
  await wrapper.locator('canvas').first().waitFor();
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('boundary-canvas has no bounding box.');
  await page.mouse.click(box.x + 300, box.y + 200);

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');
  await page.getByTestId('continue').click();
  await expect(page).toHaveURL(/\/features$/);

  // Step 2 has never gated Continue, and an empty existing garden is the common case.
  await page.getByTestId('continue').click();
  await expect(page).toHaveURL(/\/brief$/);

  return planUrl;
}

test('spaces and a style chosen from the cards survive a reload', async ({ page }) => {
  const planUrl = await reachBrief(page);

  await expect(
    page.getByRole('heading', { name: 'What would you like to add to your garden?' }),
  ).toBeVisible();

  /*
   * Clicking the *card*, not the input. The whole card is the hit target — that is the interaction
   * this redesign is for — and a test that clicked the hidden `sr-only` checkbox would pass even if
   * the label stopped wrapping it.
   */
  await page.getByTestId('space-card-dining').click();
  await page.getByTestId('space-card-hotTub').click();
  await page.getByTestId('space-card-lawn').click();

  await expect(page.getByTestId('desired-dining')).toBeChecked();
  await expect(page.getByTestId('space-card-dining')).toHaveAttribute('data-checked', 'true');

  // Continue is still gated on budget, maintenance and style — not on the spaces.
  await expect(page.getByTestId('continue')).toBeDisabled();

  await page.getByTestId('style-cottage-card').click();
  await page.getByTestId('budget-high-card').click();
  await page.getByTestId('maintenance-medium-card').click();

  await expect(page.getByTestId('continue')).toBeEnabled();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto(`${planUrl}/brief`);

  await expect(page.getByTestId('desired-dining')).toBeChecked();
  await expect(page.getByTestId('desired-hotTub')).toBeChecked();
  await expect(page.getByTestId('desired-lawn')).toBeChecked();
  await expect(page.getByTestId('desired-pergola')).not.toBeChecked();
  await expect(page.getByTestId('style-cottage')).toBeChecked();
});

test('the style row takes one answer, and swapping it replaces rather than adds', async ({
  page,
}) => {
  await reachBrief(page);

  await page.getByTestId('style-modern-card').click();
  await expect(page.getByTestId('style-modern')).toBeChecked();

  await page.getByTestId('style-formal-card').click();
  await expect(page.getByTestId('style-formal')).toBeChecked();
  await expect(page.getByTestId('style-modern')).not.toBeChecked();
});

test('Something else reveals a text box, and un-ticking it throws the text away', async ({
  page,
}) => {
  const planUrl = await reachBrief(page);

  await expect(page.getByTestId('desired-features-other')).toHaveCount(0);

  await page.getByTestId('space-card-other').click();
  await page.getByTestId('desired-features-other').fill('A sauna and a bin store');

  await page.getByTestId('style-modern-card').click();
  await page.getByTestId('budget-medium-card').click();
  await page.getByTestId('maintenance-low-card').click();
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto(`${planUrl}/brief`);
  await expect(page.getByTestId('desired-features-other')).toHaveValue('A sauna and a bin store');

  // The rule `replaceWith` follows on step 2: the text is only meaningful while the tick is on.
  await page.getByTestId('space-card-other').click();
  await expect(page.getByTestId('desired-features-other')).toHaveCount(0);
});
