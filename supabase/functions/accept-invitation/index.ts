/**
 * POST /functions/v1/accept-invitation
 *
 * Body:     { token: string }
 * Success:  200 { data: { workspaceId, workspaceName, workspaceSlug, role } }
 * Errors:   401 unauthorized, 400 validation_error, 404 not_found (unknown or already
 *           used token), 410 invitation_expired, 403 forbidden (invitation was issued
 *           to a different email, or the caller's email is not verified).
 *
 * Thin wrapper around the Postgres function `public.accept_invitation(p_token)`
 * (migration 002). The function runs as `security definer` in one transaction: it
 * looks the invitation up, checks expiry and the caller's email (read from
 * `auth.users` for `auth.uid()`), inserts the membership, stamps `accepted_at` and
 * writes the `invitation.accepted` audit event. It is called with the caller's own
 * client so `auth.uid()` is the caller; the service-role key is not needed here.
 *
 * The function raises with PostgREST-style SQLSTATEs (`PT401`, `PT403`, `PT404`,
 * `PT410`) which are mapped to the stable error codes below.
 */
import { z } from 'zod'
import { requireUser } from '../_shared/auth.ts'
import { AppError, jsonOk, type ErrorCode } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'
import type { WorkspaceRole } from '../_shared/types.ts'
import { parseBody } from '../_shared/validation.ts'

const bodySchema = z.object({
  token: z.string().trim().min(1).max(256),
})

interface AcceptRow {
  workspace_id: string
  workspace_name: string
  workspace_slug: string
  role: WorkspaceRole
}

const SQLSTATE_TO_ERROR: Record<string, { status: number; code: ErrorCode }> = {
  PT401: { status: 401, code: 'unauthorized' },
  PT403: { status: 403, code: 'forbidden' },
  PT404: { status: 404, code: 'not_found' },
  PT410: { status: 410, code: 'invitation_expired' },
  '42501': { status: 403, code: 'forbidden' }, // execute privilege denied
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    const { userClient } = await requireUser(req)
    const { token } = await parseBody(req, bodySchema)

    const { data, error } = await userClient
      .rpc('accept_invitation', { p_token: token })
      .single<AcceptRow>()

    if (error) {
      const mapped = SQLSTATE_TO_ERROR[error.code]
      if (mapped) throw new AppError(mapped.status, mapped.code, error.message)
      console.error('[accept-invitation] rpc failed', error.code, error.message)
      throw new AppError(500, 'internal', 'Could not accept the invitation')
    }

    return jsonOk(
      {
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name,
        workspaceSlug: data.workspace_slug,
        role: data.role,
      },
      cors,
    )
  }),
)
