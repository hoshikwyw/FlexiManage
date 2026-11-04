import { deleteUsersWithPrefix } from './db'
import { runId } from './env'

/**
 * Unique, recognisable data per spec run. Emails look like
 * `e2e-<run id>-<spec>-<name>-<nonce>@example.com`; workspace and module names carry
 * `<run id>-<nonce>` as well. The nonce changes per worker (a retry starts a new worker), so a
 * retried serial group never collides with what the failed attempt created. Nothing assumes an
 * empty database: three runs in a row without `db:reset` must pass.
 */
export interface E2eUser {
  email: string
  password: string
  fullName: string
}

export interface SpecData {
  /** `<run id>-<nonce>`, safe in slugs, names and emails. */
  tag: string
  /** Prefix of every email this spec creates; used for cleanup. */
  emailPrefix: string
  user(name: string, fullName: string): E2eUser
  /** Delete every auth user this spec created (their solely-owned workspaces go with them). */
  cleanup(): Promise<number>
}

export const E2E_PASSWORD = 'e2e-password-1'

function nonce(): string {
  return Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
}

export function specData(spec: string): SpecData {
  const id = runId()
  const n = nonce()
  const emailPrefix = `e2e-${id}-${spec}-${n}-`
  return {
    tag: `${id}-${n}`,
    emailPrefix,
    user: (name, fullName) => ({
      email: `${emailPrefix}${name}@example.com`,
      password: E2E_PASSWORD,
      fullName,
    }),
    cleanup: () => deleteUsersWithPrefix(emailPrefix),
  }
}

/** A real 1x1 PNG (67 bytes). */
export const PIXEL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201e5273ea60000000049454e44ae426082',
  'hex',
)
