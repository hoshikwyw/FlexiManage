import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useModule } from '../api/use-module'
import { ModuleDangerZone } from '../components/DeleteModuleDialog'
import { ModuleSettingsForm } from '../components/ModuleSettingsForm'
import { canManageModules } from '../lib/module-permissions'
import { ModuleNotFound } from './ModuleNotFound'

/** `/w/:workspaceId/modules/:moduleId/settings`: general form and, for owners/admins, the danger zone. */
export function ModuleSettingsPage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { workspace, role } = useCurrentWorkspace()
  const module = useModule(workspace?.id, moduleId)
  const canManage = canManageModules(role)

  if (!workspace) return null

  if (module.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading module">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-md" />
      </div>
    )
  }

  if (module.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <h1 className="text-xl font-semibold tracking-tight">The module could not be loaded</h1>
        <Button type="button" variant="outline" onClick={() => void module.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!module.data) return <ModuleNotFound workspaceId={workspace.id} />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
          <Link to={WORKSPACE_ROUTES.modules(workspace.id)} className="hover:underline">
            Modules
          </Link>
          <span aria-hidden="true"> / </span>
          <Link
            to={WORKSPACE_ROUTES.module(workspace.id, module.data.id)}
            className="hover:underline"
          >
            {module.data.name}
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">Module settings</h1>
        <p className="text-muted-foreground text-sm">
          Name, description and icon of {module.data.name}. Fields are managed on the{' '}
          <Link
            to={`${WORKSPACE_ROUTES.module(workspace.id, module.data.id)}?tab=fields`}
            className="text-foreground underline underline-offset-4"
          >
            Fields tab
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            The name shown in navigation and the slug used in links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModuleSettingsForm
            key={module.data.updated_at}
            workspaceId={workspace.id}
            module={module.data}
            readOnly={!canManage}
          />
        </CardContent>
      </Card>

      {canManage ? <ModuleDangerZone workspaceId={workspace.id} module={module.data} /> : null}
    </div>
  )
}
