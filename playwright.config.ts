import { defineConfig, devices } from '@playwright/test'

import { APP_ORIGIN, appEnv, newRunId } from './tests/e2e/support/env'

// One id per `playwright test` invocation, set before workers start so they all inherit it
// (tests/e2e/support/env.ts). Data created by the run carries it; teardown deletes by it.
process.env.E2E_RUN_ID ??= newRunId()

const isCI = !!process.env.CI

/**
 * The app is served by the Vite dev server on http://localhost:5173: the Edge Functions' CORS
 * allow-list contains exactly that origin (never 127.0.0.1), and specs load
 * `/src/lib/supabase.ts` in the page for crafted Storage requests, which needs dev-mode modules.
 * `appEnv` comes from the environment or the Vite env files (`.env.local` pointing at the local
 * stack); without them it holds placeholders so a clean clone still runs the smoke spec, and the
 * authenticated specs skip themselves.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: APP_ORIGIN,
    locale: 'en-US',
    timezoneId: 'UTC',
    acceptDownloads: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: APP_ORIGIN,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: appEnv,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
