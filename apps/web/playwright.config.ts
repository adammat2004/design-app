import { defineConfig, devices } from '@playwright/test';

/**
 * The plan wizard keeps its state client-side, so these specs need only the web app — the
 * webServer block below starts it. Specs that exercise the API and PostGIS will need
 * `docker compose up -d` and `pnpm --filter @garden-studio/api dev` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
