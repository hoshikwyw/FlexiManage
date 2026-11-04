import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FullConfig } from '@playwright/test'

import {
  EXPECTED_SEED_STATE,
  deleteStaleE2eUsers,
  deleteUsersWithPrefix,
  seedState,
} from './support/db'
import { EDGE_CONTAINER, hasLocalBackend, runId, supabaseAnonKey, supabaseUrl } from './support/env'

/**
 * Global setup for the e2e suite (the returned function is the global teardown).
 *
 * 1. Without a local backend (placeholder env on a clean clone) nothing is checked: only the
 *    unauthenticated smoke spec runs and the authenticated specs skip themselves.
 * 2. Otherwise the stack must answer (`/auth/v1/health`), and the Edge Functions must answer
 *    401 to a request without credentials. `supabase start` normally serves them through the
 *    edge runtime container; if the probe fails (the container was stopped after a
 *    `supabase functions serve` session), `supabase functions serve` is started here on a
 *    snapshot of the functions (see startFunctionsServe) and stopped again in teardown. Nothing
 *    is stopped that setup did not start.
 * 3. Users of aborted runs older than three hours are removed (`e2e-%@example.com`).
 *
 * Teardown deletes whatever the current run left behind (`e2e-<run id>-%`), purges the storage
 * deletion queue through `purge-attachments` (best effort, needs `supabase status`), and fails
 * the run if the seed facts changed: alice owns Workspace A only, bob owns Workspace B only, and
 * Clients still has 3 records.
 */

const FUNCTIONS_PROBE = `${supabaseUrl}/functions/v1/invite-member`

async function probeFunctions(): Promise<number> {
  try {
    const response = await fetch(FUNCTIONS_PROBE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-e2e-probe': '1' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    })
    await response.body?.cancel()
    return response.status
  } catch {
    return 0
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

const isWindows = process.platform === 'win32'

/**
 * The Supabase CLI as one shell command line: `supabase` when it is on PATH (CI installs it
 * with supabase/setup-cli), else the devDependency through npx. Both may be .cmd shims on
 * Windows, which need a shell; the line is built from constants only.
 */
function supabaseCli(subcommand: string): string {
  const probe = spawnSync('supabase --version', { stdio: 'ignore', shell: true })
  return probe.status === 0 ? `supabase ${subcommand}` : `npx --no-install supabase ${subcommand}`
}

interface FunctionsServe {
  child: ChildProcess
  workdir: string
  logFile: string
}

/**
 * `supabase functions serve` watches the served folder and recreates the runtime container on
 * any file event, which takes about five seconds; a request in that window fails (seen once in
 * the journey's accept-invitation step after an outside process touched
 * `supabase/functions/export-records`). So the functions are served from a snapshot of
 * `supabase/config.toml` and `supabase/functions` taken at setup (`--workdir`): nothing touches
 * the copy, the runtime never reloads during a run, and the run tests the code as it was when it
 * started. Same `project_id`, so the container joins the running stack's network.
 */
function startFunctionsServe(logDir: string): FunctionsServe {
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'functions-serve.log')
  const log = openSync(logFile, 'w')
  const workdir = mkdtempSync(join(tmpdir(), 'fleximanage-e2e-functions-'))
  cpSync('supabase/config.toml', join(workdir, 'supabase', 'config.toml'))
  cpSync('supabase/functions', join(workdir, 'supabase', 'functions'), { recursive: true })
  // On POSIX a detached process group lets teardown stop the shell and the CLI together.
  const child = spawn(supabaseCli(`functions serve --workdir "${workdir}"`), {
    stdio: ['ignore', log, log],
    shell: true,
    detached: !isWindows,
  })
  return { child, workdir, logFile }
}

function stopFunctionsServe({ child, workdir, logFile }: FunctionsServe): void {
  const reloads = (readFileSync(logFile, 'utf8').match(/File change detected/g) ?? []).length
  if (reloads > 0) console.warn(`[e2e] Warning: the edge runtime reloaded ${reloads} time(s).`)
  if (child.pid !== undefined) {
    try {
      if (isWindows) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(-child.pid, 'SIGTERM')
      }
    } catch {
      // Already gone.
    }
  }
  // The CLI leaves the runtime container behind when it is killed.
  spawnSync('docker', ['stop', EDGE_CONTAINER], { stdio: 'ignore' })
  rmSync(workdir, { recursive: true, force: true })
}

/** The service-role key of the local stack, read in memory only; never printed or stored. */
function localServiceRoleKey(): string | null {
  try {
    const out = execSync(supabaseCli('status -o env'), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return /^SERVICE_ROLE_KEY="?([^"\r\n]+)"?$/m.exec(out)?.[1] ?? null
  } catch {
    return null
  }
}

/** Remove storage objects of attachment rows deleted by the cleanup (operator procedure). */
async function purgeDeletedAttachments(): Promise<string> {
  const key = localServiceRoleKey()
  if (!key) return 'skipped (supabase status unavailable)'
  let purged = 0
  for (let round = 0; round < 10; round += 1) {
    const response = await fetch(`${supabaseUrl}/functions/v1/purge-attachments`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 500 }),
    })
    if (!response.ok) return `failed with HTTP ${response.status}`
    const body = (await response.json()) as { data: { purged: number; remaining: number } }
    purged += body.data.purged
    if (body.data.remaining === 0) break
  }
  return `${purged} object(s) purged`
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  if (!hasLocalBackend) {
    console.log('[e2e] No local Supabase stack configured: only the smoke spec runs.')
    return async () => {}
  }

  const health = await fetch(`${supabaseUrl}/auth/v1/health`, {
    headers: { apikey: supabaseAnonKey },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!health?.ok) {
    throw new Error(
      `[e2e] The local Supabase stack does not answer at ${supabaseUrl} (auth health ` +
        `${health?.status ?? 'unreachable'}). Start it with \`npm run db:start\`.`,
    )
  }

  let serve: FunctionsServe | null = null
  let status = await probeFunctions()
  if (status !== 401) {
    console.log(
      `[e2e] Edge Functions probe returned ${status}; starting 'supabase functions serve'.`,
    )
    serve = startFunctionsServe(join(process.cwd(), 'test-results'))
    const up = await waitFor(async () => (status = await probeFunctions()) === 401, 120_000)
    if (!up) {
      stopFunctionsServe(serve)
      throw new Error(
        `[e2e] Edge Functions did not come up (last probe ${status}); see test-results/functions-serve.log.`,
      )
    }
  }
  console.log(`[e2e] Stack and Edge Functions answer; run id ${runId()}.`)

  const stale = await deleteStaleE2eUsers()
  if (stale > 0) console.log(`[e2e] Removed ${stale} e2e user(s) left by earlier runs.`)

  return async () => {
    try {
      const leftovers = await deleteUsersWithPrefix(`e2e-${runId()}-`)
      if (leftovers > 0) console.log(`[e2e] Teardown removed ${leftovers} leftover user(s).`)
      console.log(`[e2e] Storage purge: ${await purgeDeletedAttachments()}.`)
      const seed = await seedState()
      if (JSON.stringify(seed) !== JSON.stringify(EXPECTED_SEED_STATE)) {
        throw new Error(
          `[e2e] Seed changed by the run: ${JSON.stringify(seed)}, expected ${JSON.stringify(EXPECTED_SEED_STATE)}`,
        )
      }
      console.log('[e2e] Seed intact: alice owns A only, bob owns B only, Clients has 3 records.')
    } finally {
      if (serve) stopFunctionsServe(serve)
    }
  }
}
