import { execSync, spawnSync } from 'node:child_process'

import { supabaseAnonKey, supabaseUrl } from './env'

/**
 * Operator calls against the local stack that need the service-role key: only
 * `purge-attachments` (operators only, contract in docs/architecture.md). The key is read from
 * `supabase status -o env` into memory for the call and never printed, logged or stored. Used
 * by the global teardown and by the isolation spec's cleanup assertion; no spec uses the key for
 * anything else.
 */

/**
 * The Supabase CLI as one shell command line: `supabase` when it is on PATH (CI installs it
 * with supabase/setup-cli), else the devDependency through npx. Both may be .cmd shims on
 * Windows, which need a shell; the line is built from constants only.
 */
export function supabaseCli(subcommand: string): string {
  const probe = spawnSync('supabase --version', { stdio: 'ignore', shell: true })
  return probe.status === 0 ? `supabase ${subcommand}` : `npx --no-install supabase ${subcommand}`
}

let cachedKey: string | null | undefined

/** The service-role key of the local stack, read in memory only; never printed or stored. */
export function localServiceRoleKey(): string | null {
  if (cachedKey !== undefined) return cachedKey
  try {
    const out = execSync(supabaseCli('status -o env'), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    cachedKey = /^SERVICE_ROLE_KEY="?([^"\r\n]+)"?$/m.exec(out)?.[1] ?? null
  } catch {
    cachedKey = null
  }
  return cachedKey
}

/** Response of `purge-attachments` since migration 006. */
export interface PurgeResult {
  purged: number
  alreadyGone: number
  retryable: number
  dead: number
}

/** One `purge-attachments` call. Throws on a non-200 answer or an unexpected body shape. */
export async function callPurgeAttachments(key: string, limit = 500): Promise<PurgeResult> {
  const response = await fetch(`${supabaseUrl}/functions/v1/purge-attachments`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ limit }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`purge-attachments answered HTTP ${response.status}`)
  }
  const body = (await response.json()) as { data?: Partial<PurgeResult> }
  const data = body.data ?? {}
  const keys = Object.keys(data).sort().join(',')
  if (keys !== 'alreadyGone,dead,purged,retryable') {
    throw new Error(`purge-attachments answered an unexpected shape: {${keys}}`)
  }
  return data as PurgeResult
}

export interface PurgeSummary extends PurgeResult {
  calls: number
}

/** Upper bound on calls per drain: 10 x 500 entries, far more than one run queues. */
export const MAX_PURGE_CALLS = 10

/**
 * Drain the deletion queue: call `purge-attachments` again while it reports `retryable > 0`, at
 * most `MAX_PURGE_CALLS` times. `purged` and `alreadyGone` are summed; `retryable` and `dead`
 * are the values of the last call (they describe the queue, not the call).
 */
export async function drainPurgeQueue(key: string): Promise<PurgeSummary> {
  const summary: PurgeSummary = { purged: 0, alreadyGone: 0, retryable: 0, dead: 0, calls: 0 }
  do {
    const result = await callPurgeAttachments(key)
    summary.calls += 1
    summary.purged += result.purged
    summary.alreadyGone += result.alreadyGone
    summary.retryable = result.retryable
    summary.dead = result.dead
  } while (summary.retryable > 0 && summary.calls < MAX_PURGE_CALLS)
  return summary
}
