import { LayoutDashboardIcon, UserIcon, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Match only the exact path (for `/`). */
  end?: boolean
}

/** Primary navigation rendered in the sidebar. */
export const primaryNavItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  // Part 6: workspaces, members
  // { to: '/workspaces/:slug/members', label: 'Members', icon: UsersIcon },
]

export const settingsNavItems: NavItem[] = [
  { to: '/settings/profile', label: 'Profile', icon: UserIcon },
]
