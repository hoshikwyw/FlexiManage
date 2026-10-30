import { PlusIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { RoleBadge } from '@/components/shared/role-badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useCurrentWorkspace } from '../context/workspace-context'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'

/** Dashboard card body: every workspace as a link, the current one highlighted. */
export function WorkspaceList() {
  const { workspaces, workspaceId, setWorkspaceId } = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1" aria-label="Your workspaces">
        {workspaces.map(({ workspace, role }) => {
          const isCurrent = workspace.id === workspaceId
          return (
            <li key={workspace.id}>
              <Link
                to={WORKSPACE_ROUTES.dashboard(workspace.id)}
                onClick={() => setWorkspaceId(workspace.id)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring/50 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm outline-none focus-visible:ring-3',
                  isCurrent ? 'bg-accent font-medium' : 'hover:bg-muted',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{workspace.name}</span>
                  <span className="text-muted-foreground truncate text-xs">/{workspace.slug}</span>
                </span>
                <RoleBadge role={role} />
              </Link>
            </li>
          )
        })}
      </ul>
      <div>
        <Link
          to={WORKSPACE_ROUTES.create}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <PlusIcon aria-hidden="true" />
          Create workspace
        </Link>
      </div>
    </div>
  )
}
