import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Workspace } from '@/types/database'

import { CreateWorkspaceForm } from '../components/CreateWorkspaceForm'
import { useCurrentWorkspace } from '../context/workspace-context'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'

/**
 * `/workspaces/new`: first-run page (the dashboard redirects here when the
 * user has no workspace) and the full-page variant of the create dialog.
 */
export function CreateWorkspacePage() {
  const { workspaces, setWorkspaceId } = useCurrentWorkspace()
  const navigate = useNavigate()
  const firstRun = workspaces.length === 0

  function handleCreated(workspace: Workspace) {
    setWorkspaceId(workspace.id)
    toast.success(`Workspace "${workspace.name}" created`)
    navigate(WORKSPACE_ROUTES.dashboard(workspace.id), { replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstRun ? 'Create your first workspace' : 'Create a workspace'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {firstRun
            ? 'A workspace holds your team, modules and records. You can create more later.'
            : 'You become the owner of the new workspace.'}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
          <CardDescription>
            Pick a name; the slug is derived from it and can be edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateWorkspaceForm
            onCreated={handleCreated}
            onCancel={firstRun ? undefined : () => navigate(-1)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
