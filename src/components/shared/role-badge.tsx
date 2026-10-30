import { Badge } from '@/components/ui/badge'
import { getRoleLabel } from '@/lib/workspace-roles'
import type { WorkspaceRole } from '@/types/database'

const ROLE_VARIANTS: Record<WorkspaceRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
  member: 'outline',
}

/** Small badge naming a workspace role. */
export function RoleBadge({ role, className }: { role: WorkspaceRole; className?: string }) {
  return (
    <Badge variant={ROLE_VARIANTS[role]} className={className} data-role={role}>
      {getRoleLabel(role)}
    </Badge>
  )
}
