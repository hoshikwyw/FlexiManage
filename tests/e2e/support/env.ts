import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'

/**
 * Environment of the e2e suite. Imported by `playwright.config.ts`, the global setup and the
 * specs, so it must not touch the DOM or Playwright APIs.
 *
 * The SPA throws at startup without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. They come from
 * the process environment or the Vite env files of the dev server (`.env`, `.env.local`,
 * `.env.development`, ...). Without them placeholders are injected so a clean clone can still
 * run the unauthenticated smoke spec; every authenticated spec then skips itself.
 */
const viteEnv = loadEnv('development', process.cwd(), 'VITE_')

export const PLACEHOLDER_SUPABASE_URL = 'https://e2e-placeholder.supabase.co'
export const PLACEHOLDER_ANON_KEY = 'e2e-placeholder-anon-key'

export const supabaseUrl = (viteEnv.VITE_SUPABASE_URL ?? PLACEHOLDER_SUPABASE_URL).replace(
  /\/+$/,
  '',
)
export const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? PLACEHOLDER_ANON_KEY

/** Values handed to the dev server started by Playwright's `webServer`. */
export const appEnv = {
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
}

/**
 * Authenticated specs write data and read the database through `docker exec` / `psql`, so they
 * only run against the local Supabase stack, never against a hosted project.
 */
export const hasLocalBackend =
  supabaseUrl !== PLACEHOLDER_SUPABASE_URL &&
  supabaseAnonKey !== PLACEHOLDER_ANON_KEY &&
  /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(supabaseUrl)

export const SKIP_WITHOUT_BACKEND =
  'Needs the local Supabase stack: VITE_SUPABASE_URL is a placeholder or not a local URL. ' +
  'Run `npm run db:start` and point .env.local at it (see README, "End-to-end tests").'

/** The Edge Functions' CORS allow-list contains this origin only; never use 127.0.0.1 here. */
export const APP_ORIGIN = 'http://localhost:5173'

export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'

/** Local database URL (psql in CI); the docker fallback uses the container below. */
export const DB_URL =
  process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

function readProjectId(): string {
  try {
    const toml = readFileSync('supabase/config.toml', 'utf8')
    return /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? 'fleximanage'
  } catch {
    return 'fleximanage'
  }
}

export const PROJECT_ID = readProjectId()
export const DB_CONTAINER = `supabase_db_${PROJECT_ID}`
export const EDGE_CONTAINER = `supabase_edge_runtime_${PROJECT_ID}`

/**
 * One id per `playwright test` invocation. `playwright.config.ts` sets it in the main process
 * before any worker starts, so every worker (and the global setup and teardown) sees the same
 * value. All data created by the run carries it.
 */
export function runId(): string {
  const id = process.env.E2E_RUN_ID
  if (!id) throw new Error('E2E_RUN_ID is not set; run the suite through playwright.config.ts')
  return id
}

export function newRunId(): string {
  const time = Date.now().toString(36)
  const random = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .padStart(3, '0')
  return `${time}${random}`
}
