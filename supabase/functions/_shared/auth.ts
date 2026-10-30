import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { AppError } from './errors.ts'
import type { WorkspaceRole } from './types.ts'

/**
 * Reads a required environment variable. Values are never logged or returned.
 * Falls back to the newer key names the CLI also injects (publishable/secret).
 */
function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? (fallback ? Deno.env.get(fallback) : undefined)
  if (!value) throw new AppError(500, 'internal', `Missing environment variable ${name}`)
  return value
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

/**
 * Service-role client. Bypasses RLS: use it only after the caller's identity and
 * role have been verified, and only for the reads/writes RLS would block.
 */
export function adminClient(): SupabaseClient {
  return createClient(
    env('SUPABASE_URL'),
    env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
    clientOptions,
  )
}

export interface AuthenticatedCaller {
  user: User
  /** Client scoped to the caller: RLS and `auth.uid()` apply as in the browser. */
  userClient: SupabaseClient
}

/**
 * Verifies the bearer token with Auth (`auth.getUser`) and returns the user plus
 * a client that forwards the caller's JWT, so Postgres sees `auth.uid()` = caller.
 * Throws 401 `unauthorized` when the header is missing or the token is invalid.
 */
export async function requireUser(req: Request): Promise<AuthenticatedCaller> {
  const header = req.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match?.[1]?.trim()
  if (!token) {
    throw new AppError(401, 'unauthorized', 'Missing or malformed Authorization header')
  }

  const userClient = createClient(
    env('SUPABASE_URL'),
    env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'),
    {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  )

  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data.user) {
    throw new AppError(401, 'unauthorized', 'Invalid or expired session')
  }
  return { user: data.user, userClient }
}

/**
 * Loads the caller's role in the workspace and checks it against `allowedRoles`.
 * Non-members and members with an insufficient role both get 403 `forbidden`, so
 * the response does not reveal whether the workspace exists.
 */
export async function requireWorkspaceRole(
  admin: SupabaseClient,
  workspaceId: string,
  userId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<WorkspaceRole> {
  const { data, error } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle<{ role: WorkspaceRole }>()

  if (error) throw new AppError(500, 'internal', 'Could not load workspace membership')
  if (!data || !allowedRoles.includes(data.role)) {
    throw new AppError(403, 'forbidden', 'You do not have permission to do this in that workspace')
  }
  return data.role
}
