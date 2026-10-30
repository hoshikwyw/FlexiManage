import { CheckIcon, ChevronsUpDownIcon, PlusIcon, Settings2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { RoleBadge } from '@/components/shared/role-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { useCurrentWorkspace } from '../context/workspace-context'
import { canManageWorkspace } from '../lib/workspace-permissions'
import { WORKSPACE_ROUTES, swapWorkspaceInPath } from '../lib/workspace-routes'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'

interface WorkspaceSwitcherProps {
  /** Called after a workspace is chosen (closes the mobile sheet). */
  onNavigate?: () => void
}

/**
 * Sidebar dropdown: every workspace of the user (name + role, current one
 * ticked), a link to the current workspace's settings for owners/admins and a
 * "Create workspace" action. Switching keeps the current sub-page
 * (`/w/A/members` -> `/w/B/members`).
 */
export function WorkspaceSwitcher({ onNavigate }: WorkspaceSwitcherProps) {
  const { workspaces, workspace, role, isLoading, isError, refetch, setWorkspaceId } =
    useCurrentWorkspace()
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  if (isLoading) {
    return <Skeleton className="h-9 w-full" aria-label="Loading workspaces" />
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col gap-1 text-xs">
        <span className="text-destructive">Workspaces could not be loaded.</span>
        <Button type="button" size="xs" variant="outline" onClick={refetch}>
          Try again
        </Button>
      </div>
    )
  }

  if (!workspace) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon aria-hidden="true" />
          Create workspace
        </Button>
        <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    )
  }

  function select(workspaceId: string) {
    setWorkspaceId(workspaceId)
    navigate(swapWorkspaceInPath(location.pathname, workspaceId))
    onNavigate?.()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className="h-9 w-full justify-between gap-2 px-2"
              aria-label={`Current workspace: ${workspace.name}. Switch workspace`}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{workspace.name}</span>
            {role ? <RoleBadge role={role} /> : null}
          </span>
          <ChevronsUpDownIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((membership) => {
              const isCurrent = membership.workspace.id === workspace.id
              return (
                <DropdownMenuItem
                  key={membership.workspace.id}
                  onClick={() => select(membership.workspace.id)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn(isCurrent && 'bg-accent/60 font-medium')}
                >
                  <CheckIcon
                    className={cn('size-4', !isCurrent && 'invisible')}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{membership.workspace.name}</span>
                  <RoleBadge role={membership.role} />
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {canManageWorkspace(role) ? (
            <DropdownMenuItem
              render={<Link to={WORKSPACE_ROUTES.settings(workspace.id)} onClick={onNavigate} />}
            >
              <Settings2Icon aria-hidden="true" />
              Workspace settings
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
