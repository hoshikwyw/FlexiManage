import { NavLink } from 'react-router-dom'

import { getPrimaryNavItems, settingsNavItems, type NavItem } from '@/app/navigation'
import { Separator } from '@/components/ui/separator'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { cn } from '@/lib/utils'

interface SidebarNavProps {
  /** Called after a link is activated (closes the mobile sheet). */
  onNavigate?: () => void
}

/** Sidebar content shared by the desktop aside and the mobile sheet. */
export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const { workspaceId, role } = useCurrentWorkspace()
  const primaryNavItems = getPrimaryNavItems(workspaceId, role)

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-14 flex-col justify-center gap-2 px-4 py-3">
        <span className="font-heading text-lg font-semibold tracking-tight">FlexiManage</span>
        <WorkspaceSwitcher onNavigate={onNavigate} />
      </div>
      <Separator />
      <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto p-3">
        {primaryNavItems.length > 0 ? (
          <NavSection items={primaryNavItems} onNavigate={onNavigate} />
        ) : null}
        <NavSection title="Settings" items={settingsNavItems} onNavigate={onNavigate} />
      </nav>
    </div>
  )
}

function NavSection({
  title,
  items,
  onNavigate,
}: {
  title?: string
  items: NavItem[]
  onNavigate?: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {title ? (
        <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
          {title}
        </p>
      ) : null}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )
          }
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </div>
  )
}
