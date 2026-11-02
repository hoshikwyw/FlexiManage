import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

const port = 4173
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

// The SPA throws at startup without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Take them from
// the process environment or the Vite env files (.env, .env.local, ...) and fall back to
// placeholders so a clean clone can run the unauthenticated smoke spec. Real end-to-end tests
// against the local stack need a `.env.local` that points at it (see README).
const viteEnv = loadEnv('production', process.cwd(), 'VITE_')
const supabaseEnv = {
  VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL ?? 'https://e2e-placeholder.supabase.co',
  VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY ?? 'e2e-placeholder-anon-key',
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: supabaseEnv,
  },
})
