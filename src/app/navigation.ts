import {
  LayoutDashboardIcon,
  Settings2Icon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'
import { canManageWorkspace } from '@/features/workspaces/lib/workspace-permissions'
import type { WorkspaceRole } from '@/types/database'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Match only the exact path (for the dashboard). */
  end?: boolean
}

/**
 * Primary navigation for the current workspace. Empty when the user has no
 * workspace yet (the sidebar then only offers "Create workspace").
 */
export function getPrimaryNavItems(
  workspaceId: string | null,
  role: WorkspaceRole | null = null,
): NavItem[] {
  if (!workspaceId) return []
  const items: NavItem[] = [
    {
      to: WORKSPACE_ROUTES.dashboard(workspaceId),
      label: 'Dashboard',
      icon: LayoutDashboardIcon,
      end: true,
    },
    { to: WORKSPACE_ROUTES.members(workspaceId), label: 'Members', icon: UsersIcon },
  ]
  if (canManageWorkspace(role)) {
    items.push({
      to: WORKSPACE_ROUTES.settings(workspaceId),
      label: 'Workspace settings',
      icon: Settings2Icon,
    })
  }
  return items
}

/** Account-level navigation, independent of the workspace. */
export const settingsNavItems: NavItem[] = [
  { to: '/settings/profile', label: 'Profile', icon: UserIcon },
]
