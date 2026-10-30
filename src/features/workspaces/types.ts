import type { AuditEvent, Profile, Workspace, WorkspaceRole } from '@/types/database'

/** A workspace the signed-in user belongs to, with their role in it. */
export interface WorkspaceMembership {
  workspace: Workspace
  role: WorkspaceRole
  /** When the user joined (`workspace_members.created_at`). */
  joinedAt: string
}

/** Audit row joined with the actor's profile (null when the actor is unknown or hidden by RLS). */
export interface AuditEventWithActor extends AuditEvent {
  actor: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}
