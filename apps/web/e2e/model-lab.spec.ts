import { expect, test } from '@playwright/test';

/**
 * The model lab as a developer without generation switched on sees it — which is the default, and
 * what a marker sees: it says why generation is off, the button that would spend is disabled, and
 * the spec form still composes the reference prompt and the command that draws one. Nothing here can
 * spend a credit: the API refuses to generate unless `MODEL_GENERATION_ENABLED=true`.
 */
test('the model lab says generation is off, and will not spend', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/model-lab');
  await expect(page.getByTestId('model-lab')).toBeVisible();
  const status = page.getByTestId('model-lab-status');
  await expect(status).toContainText(/Generation is (off|on)/);
  test.skip(
    (await status.textContent())?.includes('Generation is on') ?? false,
    'generation is switched on here',
  );

  await expect(status).toContainText('MODEL_GENERATION_ENABLED');
  await expect(page.getByTestId('model-lab-generate')).toBeDisabled();

  // The spec composes its own prompt and the command that draws a reference for it.
  await page.getByTestId('model-lab-frame').selectOption('dark-stained-timber');
  await page.getByTestId('model-lab-roof-finish').selectOption('shingle-dark');
  await page.getByText('The reference prompt for this spec').click();
  await expect(page.getByText(/covered in dark shingles/)).toBeVisible();
  await expect(
    page.getByText(
      /generate:references --symbol gazebo --preset classic --frame dark-stained-timber/,
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
