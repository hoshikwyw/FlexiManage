import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { DangerZone } from '../components/DangerZone'
import { WorkspaceSettingsForm } from '../components/WorkspaceSettingsForm'
import { useCurrentWorkspace } from '../context/workspace-context'
import { canDeleteWorkspace, canManageWorkspace } from '../lib/workspace-permissions'

/** `/w/:workspaceId/settings`: general settings and, for owners, the danger zone. */
export function WorkspaceSettingsPage() {
  const { workspace, role } = useCurrentWorkspace()
  if (!workspace) return null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="text-muted-foreground text-sm">General settings for {workspace.name}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>The name shown to members and the slug used in links.</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceSettingsForm
            key={workspace.updated_at}
            workspace={workspace}
            readOnly={!canManageWorkspace(role)}
          />
        </CardContent>
      </Card>

      {canDeleteWorkspace(role) ? <DangerZone workspace={workspace} /> : null}
    </div>
  )
}
