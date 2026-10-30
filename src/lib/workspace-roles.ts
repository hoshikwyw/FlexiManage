import type { WorkspaceRole } from '@/types/database'

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

/** Capitalised label for a workspace role ("Owner"). */
export function getRoleLabel(role: WorkspaceRole): string {
  return ROLE_LABELS[role]
}
