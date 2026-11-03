import type { WorkspaceRole } from '@/types/database'

/**
 * Mirror of the `modules` and `field_definitions` policies (docs/architecture.md):
 * every member reads, owners and admins write. Used only to hide controls; RLS
 * enforces the rule on every statement.
 */
export function canManageModules(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
