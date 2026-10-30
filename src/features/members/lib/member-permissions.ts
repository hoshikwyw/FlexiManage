import type { WorkspaceRole } from '@/types/database'

/**
 * Mirror of the server rules for `workspace_members` and `invitations`
 * (docs/architecture.md, policy matrix). The UI uses these to hide controls;
 * RLS, the last-owner trigger and the Edge Functions enforce them.
 */

/** Owners and admins may invite. */
export function canInvite(callerRole: WorkspaceRole | null | undefined): boolean {
  return callerRole === 'owner' || callerRole === 'admin'
}

/** Roles the caller may grant in an invitation: only an owner may grant owner. */
export function invitableRoles(callerRole: WorkspaceRole | null | undefined): WorkspaceRole[] {
  if (callerRole === 'owner') return ['owner', 'admin', 'member']
  if (callerRole === 'admin') return ['admin', 'member']
  return []
}

/** Owners and admins see and revoke pending invitations. */
export function canManageInvitations(callerRole: WorkspaceRole | null | undefined): boolean {
  return canInvite(callerRole)
}

/** Only owners change roles (`workspace_members_update_owner`). */
export function canChangeRole(
  callerRole: WorkspaceRole | null | undefined,
  options: { isSelf: boolean },
): boolean {
  // Changing your own role is allowed by RLS but hidden: demoting yourself as
  // the last owner fails anyway, and promoting yourself is a no-op for owners.
  return callerRole === 'owner' && !options.isSelf
}

/**
 * `workspace_members_delete_owner_admin_or_self`: anyone may remove themselves,
 * owners remove anyone, admins remove non-owners.
 */
export function canRemoveMember(
  callerRole: WorkspaceRole | null | undefined,
  targetRole: WorkspaceRole,
  options: { isSelf: boolean },
): boolean {
  if (options.isSelf) return true
  if (callerRole === 'owner') return true
  if (callerRole === 'admin') return targetRole !== 'owner'
  return false
}
