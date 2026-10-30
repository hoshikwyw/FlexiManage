import { Navigate } from 'react-router-dom'

import { FullPageSpinner } from '@/components/shared/full-page-spinner'
import { Button } from '@/components/ui/button'

import { useCurrentWorkspace } from '../context/workspace-context'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'

/** `/`: go to the current workspace's dashboard, or to the first-run page when there is none. */
export function RootRedirect() {
  const { workspaceId, isLoading, isError, refetch } = useCurrentWorkspace()

  if (isLoading) return <FullPageSpinner label="Loading your workspaces" />

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

  return (
    <Navigate
      to={workspaceId ? WORKSPACE_ROUTES.dashboard(workspaceId) : WORKSPACE_ROUTES.create}
      replace
    />
  )
}
