import type { WorkspaceRole } from '@/types/database'

/**
 * Mirror of the server rules for the `workspaces` table (docs/architecture.md,
 * policy matrix). The UI uses these only to hide controls; RLS enforces them.
 */
export function canManageWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function canDeleteWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner'
}
