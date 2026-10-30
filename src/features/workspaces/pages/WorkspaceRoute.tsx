import { useEffect } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'
import { Button, buttonVariants } from '@/components/ui/button'

import { useCurrentWorkspace } from '../context/workspace-context'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'

/**
 * Layout route for `/w/:workspaceId/*`. Makes the URL the source of truth: it
 * selects the workspace from the param, shows a not-found page when the user
 * is not a member (RLS would return nothing anyway) and renders the child
 * page only once the provider agrees with the URL, so pages can rely on
 * `useCurrentWorkspace()` matching the address bar.
 */
export function WorkspaceRoute() {
  const { workspaceId: param } = useParams<{ workspaceId: string }>()
  const { workspaces, workspaceId, setWorkspaceId, isLoading, isError, refetch } =
    useCurrentWorkspace()

  const isMember = param !== undefined && workspaces.some((m) => m.workspace.id === param)

  useEffect(() => {
    if (isMember && param && param !== workspaceId) setWorkspaceId(param)
  }, [isMember, param, setWorkspaceId, workspaceId])

  if (isLoading) return <FullPageSpinner label="Loading workspace" />

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Workspaces could not be loaded</h1>
        <Button type="button" variant="outline" onClick={refetch}>
          Try again
        </Button>
      </div>
    )
  }

  if (!isMember) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm font-medium">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace not found</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          This workspace does not exist or you are not a member of it. Ask an owner or admin for an
          invitation.
        </p>
        <Link to={WORKSPACE_ROUTES.root} className={buttonVariants()}>
          Go to my workspaces
        </Link>
      </div>
    )
  }

  if (workspaceId !== param) return <FullPageSpinner label="Switching workspace" />

  return <Outlet />
}
