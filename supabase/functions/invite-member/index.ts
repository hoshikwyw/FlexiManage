/**
 * POST /functions/v1/invite-member
 *
 * Body:     { workspaceId: uuid, email: string, role: 'owner' | 'admin' | 'member' }
 * Success:  200 { data: { id, email, role, expiresAt } }   (the token is never returned)
 * Errors:   401 unauthorized, 400 validation_error, 403 forbidden (not a member, not
 *           owner/admin, or admin inviting as owner), 409 conflict (already a member).
 *
 * Idempotent: a pending, unexpired invitation for the same email returns 200 with
 * the existing row instead of creating a duplicate. The database enforces this too
 * (partial unique index `invitations_pending_unique` on (workspace_id, lower(email))
 * where accepted_at is null, migration 003): when two requests race past the lookup,
 * the loser's insert fails with 23505 and is answered with the winner's row.
 * Expired pending invitations for the address are deleted first (as the caller,
 * under RLS; the trigger writes `invitation.revoked`) so they never block a re-invite.
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

/** Escapes LIKE wildcards so `ilike` matches the address literally, case-insensitively. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
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
    const now = new Date().toISOString()
    const findPending = async (): Promise<InvitationRow | undefined> => {
      const { data, error } = await admin
        .from('invitations')
        .select('id, email, role, expires_at')
        .eq('workspace_id', body.workspaceId)
        .is('accepted_at', null)
        .gt('expires_at', now)
      if (error) throw new AppError(500, 'internal', 'Could not load invitations')
      return (data ?? []).find((inv: InvitationRow) => inv.email.toLowerCase() === body.email)
    }

    const existing = await findPending()
    if (existing) return jsonOk(toResponse(existing), cors)

    // An expired pending invitation would still trip the pending-unique index:
    // remove it as the caller (RLS: owner/admin may delete; audit: invitation.revoked).
    const { error: expireError } = await userClient
      .from('invitations')
      .delete()
      .eq('workspace_id', body.workspaceId)
      .is('accepted_at', null)
      .lte('expires_at', now)
      .ilike('email', likeLiteral(body.email))
    if (expireError) {
      console.error('[invite-member] expired cleanup failed', expireError.code, expireError.message)
      throw new AppError(500, 'internal', 'Could not replace the expired invitation')
    }

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
      // 23505 = a concurrent request created the pending invitation first: return it.
      if (insertError.code === '23505') {
        const winner = await findPending()
        if (winner) return jsonOk(toResponse(winner), cors)
        throw new AppError(
          409,
          'conflict',
          'An invitation for this email is being processed; try again',
        )
      }
      console.error('[invite-member] insert failed', insertError.code, insertError.message)
      throw new AppError(500, 'internal', 'Could not create the invitation')
    }

    return jsonOk(toResponse(created), cors)
  }),
)
