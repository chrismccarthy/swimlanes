import { defineConfig, devices } from '@playwright/test';

const PORT = 5175;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end suite. It drives the localStorage-backed artifact build
 * (`vite.artifact.config.ts`), which needs no Supabase and shows no login
 * screen, so every run starts from a clean, self-contained app.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  // In CI an HTML report is written to `playwright-report/` as well, so the
  // workflow can upload it (with the first-retry traces) when a run fails.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // A viewport wide enough for several weeks of timeline, but narrow
      // enough that the initial "scroll to today" stays clear of the
      // infinite-scroll expansion threshold.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 800 } },
    },
  ],
  webServer: {
    command: `npx vite --config vite.artifact.config.ts --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
