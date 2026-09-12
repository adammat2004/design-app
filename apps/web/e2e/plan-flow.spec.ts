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
  await expect(page.getByTestId('doors-status')).toContainText('No door onto the garden yet');
  await page.getByTestId('suggest-patio-door').click();

  await expect(page.getByTestId('doors-status')).toContainText('Garden door');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  // Back on the plan, the wall the door names still exists, so it still resolves.
  await expect(page.getByTestId('doors-status')).toContainText('Garden door');
});

test('an unknown plan id is a 404, and says so rather than blaming the server', async ({
  page,
}) => {
  /*
   * Two assertions because they can disagree. The status is what a crawler and the browser see;
   * the screen is what the person sees, and until the layout learned to tell three failures apart
   * it showed this same "could not be found" page to anyone who had simply not started the API.
   */
  const response = await page.goto('/plan/11111111-2222-3333-4444-555555555555/map');

  expect(response?.status()).toBe(404);
  await expect(page.getByTestId('plan-not-found')).toBeVisible();
  await expect(page.getByTestId('api-unreachable')).toHaveCount(0);
});

/**
 * The other half of persistence.
 *
 * "A drawn boundary survives a reload" proves the plan is *stored*. This proves it is
 * *reachable* — which is a different claim, and for most of this project's life it was false:
 * `GET /plan-projects` existed, `listProjects()` existed, and nothing called it, so closing the
 * tab without bookmarking the URL lost the garden. Only the full stack can test this.
 */
test('a saved plan can be found again from the front door', async ({ page }) => {
  await page.goto('/plan');
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}\/map$/);
  const planUrl = page.url();

  await drawBoundary(page);
  // Let the debounced autosave land, so the plan has a real updatedAt to list.
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, {
    timeout: 15_000,
  });

  // Leave entirely, as someone closing the tab would.
  await page.goto('/');
  await page.getByTestId('your-plans').click();
  await expect(page).toHaveURL(/\/projects$/);

  const listed = page.getByTestId('projects-list').locator('a').first();
  await expect(listed).toBeVisible();
  await listed.click();

  // Back in a plan, and the boundary is still closed.
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}\/map$/);
  await expect(page.getByTestId('close-shape')).toHaveCount(0);
  expect(page.url()).toBe(planUrl);
});

test('a side gate and the street edge survive a reload', async ({ page }) => {
  await page.goto('/plan');
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();

  // In house mode a plain click drops the default footprint where it lands.
  await clickPlan(page, 300, 200);

  await expect(page.getByTestId('gates-count')).toHaveText('No gate');

  // Offered, not applied: the chips place nothing until they are taken.
  await page.getByTestId('suggest-street-edge').click();
  await page.getByTestId('suggest-side-gate').click();

  await expect(page.getByTestId('gates-count')).toHaveText('1 gate');
  await expect(page.getByTestId('street-status')).toHaveText('Street side chosen');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  // Back on the plan, the fence the gate names still exists, so it still resolves.
  await expect(page.getByTestId('gates-count')).toHaveText('1 gate');
  await expect(page.getByTestId('street-status')).toHaveText('Street side chosen');
});

/**
 * The selection model, end to end.
 *
 * Everything about a side of the property is now edited by clicking that side, and everything
 * about a wall by clicking that wall — so the thing worth proving through the whole stack is that
 * the click reaches the right target, the panel is about it, and what is stated there survives the
 * round trip into JSONB and back.
 */
test('a side of the plot can be described by clicking it, and it persists', async ({ page }) => {
  await page.goto('/plan');
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();
  await clickPlan(page, 300, 200);

  // Placing the house lands in Select, which is where the property is described.
  await expect(page.getByTestId('selected-house')).toBeVisible();

  /*
   * A real pointer click on the side itself. Konva shapes are not DOM, so there is no element to
   * address — the side's own length chip *is* HTML and sits at the edge's midpoint, so its box
   * gives the pixel to aim at whatever the fit-on-load frame turned out to be. (The headless
   * canvas is only about 420 px tall, so a hard-coded offset would miss.)
   */
  const chip = await page.getByTestId('edge-label-0').boundingBox();
  if (!chip) throw new Error('The first side has no length chip to aim at.');
  await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);

  await expect(page.getByTestId('side-editor')).toBeVisible();
  await expect(page.getByTestId('side-heading')).toContainText('Side A → B');

  await page.getByTestId('side-kind-hedge').click();
  await page.getByTestId('add-gate-pedestrian').click();

  await expect(page.getByTestId('side-gates')).toContainText('Gate');
  await expect(page.getByTestId('gates-count')).toHaveText('1 gate');

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  // The corner the side starts at still exists, so both the hedge and the gate still resolve.
  await expect(page.getByTestId('gates-count')).toHaveText('1 gate');

  /*
   * Reached by keyboard this time. Every selectable thing on the plan has a real button in the
   * off-screen list, which is how the canvas is usable without a mouse at all; focusing one
   * selects it.
   */
  await page.getByTestId('side-A').focus();
  await expect(page.getByTestId('side-kind-hedge')).toHaveAttribute('aria-pressed', 'true');
});

/**
 * Dragging a gate along its fence, which is the one thing about this feature no unit test can
 * reach: Konva's hit-testing decides whether the pointer grabbed the gate's body or one of its
 * end handles, and that only happens in a browser at a real zoom. It has already been worth it —
 * the first version of the handle let the end grabs swallow the middle of a 900 mm gate, so every
 * drag silently resized it instead of moving it.
 */
test('a gate can be dragged along its fence, and one undo puts it back', async ({ page }) => {
  await page.goto('/plan');

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();
  await clickPlan(page, 300, 200);

  const chip = await page.getByTestId('edge-label-0').boundingBox();
  if (!chip) throw new Error('The first side has no length chip to aim at.');
  await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);

  await page.getByTestId('add-gate-pedestrian').click();
  const before = await page.getByTestId('gate-offset').inputValue();
  const width = await page.getByTestId('gate-width').inputValue();

  // The side runs across the top of the plot, so the gate sits on it at the chip's own position.
  const y = chip.y + chip.height / 2;
  await page.mouse.move(chip.x + chip.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(chip.x + chip.width / 2 - 60, y, { steps: 10 });
  await page.mouse.up();

  // It moved along the fence, and a move is not a resize.
  expect(Number(await page.getByTestId('gate-offset').inputValue())).toBeLessThan(Number(before));
  await expect(page.getByTestId('gate-width')).toHaveValue(width);

  // One entry for the whole gesture, and the gate is still what the panel is about afterwards.
  await page.getByTestId('canvas-tool-undo').click();
  await expect(page.getByTestId('gate-offset')).toHaveValue(before);
});

/**
 * The house twin of the test above: a wall is selected, classified and given a window, and the
 * window is still on that wall after a round trip through JSONB.
 */
test('a wall of the house can be given a window, and it persists', async ({ page }) => {
  await page.goto('/plan');
  const planUrl = page.url();

  await page.getByTestId('plot-preset-rectangle').click();
  await page.getByTestId('plot-shape-continue').click();
  await clickPlan(page, 300, 200);

  await page.getByTestId('select-wall-w0').focus();
  await expect(page.getByTestId('wall-editor')).toBeVisible();
  await expect(page.getByTestId('wall-heading')).toContainText('Wall 1');

  await page.getByTestId('add-opening-window').click();
  await expect(page.getByTestId('opening-inspector')).toBeVisible();

  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved');

  await page.goto('about:blank');
  await page.goto(planUrl);

  await page.getByTestId('select-wall-w0').focus();
  await expect(page.getByTestId('wall-track')).toBeVisible();
  await expect(page.getByTestId('wall-editor')).toContainText('Window');
});
