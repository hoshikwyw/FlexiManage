import type { Profile, WorkspaceMember, WorkspaceRole } from '@/types/database'

/** A membership row with the member's profile (null only if RLS hid it, which should not happen for co-members). */
export interface Member extends WorkspaceMember {
  profile: Pick<Profile, 'id' | 'email' | 'full_name' | 'avatar_url'> | null
}

/** Stable error codes returned by the Edge Functions (see docs/architecture.md). */
export type FunctionErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invitation_expired'
  | 'method_not_allowed'
  | 'internal'

/** `invite-member` success payload. */
export interface InviteMemberResult {
  id: string
  email: string
  role: WorkspaceRole
  expiresAt: string
}

/** `accept-invitation` success payload. */
export interface AcceptInvitationResult {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  role: WorkspaceRole
}
