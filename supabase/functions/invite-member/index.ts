/**
 * POST /functions/v1/invite-member
 *
 * Body:     { workspaceId: uuid, email: string, role: 'owner' | 'admin' | 'member' }
 * Success:  200 { data: { id, email, role, expiresAt } }   (the token is never returned)
 * Errors:   401 unauthorized, 400 validation_error, 403 forbidden (not a member, not
 *           owner/admin, or admin inviting as owner), 409 conflict (already a member).
 *
 * Idempotent: a pending, unexpired invitation for the same email returns 200 with
 * the existing row instead of creating a duplicate.
 *
 * Order of operations (agent rule): verify JWT -> load caller's role -> check the
 * business rules -> act. The insert runs through the caller's own client so RLS
 * enforces the same rules a second time and the `invitations_audit` trigger records
 * `auth.uid()` as the actor of `invitation.created`. The service-role client is only
 * used for the lookups (membership, existing members' emails, pending invitations).
 */
import { z } from 'zod'
import { adminClient, requireUser, requireWorkspaceRole } from '../_shared/auth.ts'
import { AppError, jsonOk } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'
import { WORKSPACE_ROLES, type WorkspaceRole } from '../_shared/types.ts'
import { parseBody } from '../_shared/validation.ts'

const bodySchema = z.object({
  // z.guid(), not z.uuid(): Zod 4's uuid() enforces RFC 4122 version/variant bits, which
  // rejects the fixed seed ids used locally and in tests. Postgres validates the uuid.
  workspaceId: z.guid(),
  email: z.string().trim().toLowerCase().min(3).max(320).pipe(z.email()),
  role: z.enum(WORKSPACE_ROLES),
})

interface InvitationRow {
  id: string
  email: string
  role: WorkspaceRole
  expires_at: string
}

function toResponse(row: InvitationRow) {
  return { id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at }
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    const { user, userClient } = await requireUser(req)
    const body = await parseBody(req, bodySchema)
    const admin = adminClient()

    const callerRole = await requireWorkspaceRole(admin, body.workspaceId, user.id, [
      'owner',
      'admin',
    ])
    if (body.role === 'owner' && callerRole !== 'owner') {
      throw new AppError(403, 'forbidden', 'Only an owner can invite another owner')
    }

    // Already a member? Compare emails case-insensitively via the members' profiles.
    const { data: members, error: membersError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', body.workspaceId)
    if (membersError) throw new AppError(500, 'internal', 'Could not load members')

    const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
    if (memberIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('email')
        .in('id', memberIds)
      if (profilesError) throw new AppError(500, 'internal', 'Could not load member profiles')

      const isMember = (profiles ?? []).some(
        (p: { email: string }) => p.email.toLowerCase() === body.email,
      )
      if (isMember) {
        throw new AppError(409, 'conflict', 'This person is already a member of the workspace')
      }
    }

    // Pending, unexpired invitation for the same email: return it (idempotent).
    const { data: pending, error: pendingError } = await admin
      .from('invitations')
      .select('id, email, role, expires_at')
      .eq('workspace_id', body.workspaceId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
    if (pendingError) throw new AppError(500, 'internal', 'Could not load invitations')

    const existing = (pending ?? []).find(
      (inv: InvitationRow) => inv.email.toLowerCase() === body.email,
    )
    if (existing) return jsonOk(toResponse(existing), cors)

    // Insert as the caller: RLS re-checks owner/admin, invited_by = auth.uid() and the
    // owner-only rule; the audit trigger writes invitation.created with the caller as actor.
    const { data: created, error: insertError } = await userClient
      .from('invitations')
      .insert({
        workspace_id: body.workspaceId,
        email: body.email,
        role: body.role,
        invited_by: user.id,
      })
      .select('id, email, role, expires_at')
      .single<InvitationRow>()

    if (insertError) {
      // 42501 = RLS rejected the row: the role check above and the policy disagree.
      if (insertError.code === '42501') {
        throw new AppError(403, 'forbidden', 'You do not have permission to create this invitation')
      }
      console.error('[invite-member] insert failed', insertError.code, insertError.message)
      throw new AppError(500, 'internal', 'Could not create the invitation')
    }

    return jsonOk(toResponse(created), cors)
  }),
)
