import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFieldDefinitions } from '@/features/modules/api/use-field-definitions'
import { useModule } from '@/features/modules/api/use-module'
import { ModuleNotFound } from '@/features/modules/pages/ModuleNotFound'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'
import type { FieldDefinition, Module } from '@/types/database'

export interface RecordPageContext {
  workspaceId: string
  module: Module
  fields: FieldDefinition[]
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={label}>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-64 w-full max-w-2xl" />
    </div>
  )
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{what} could not be loaded</h1>
      <Button type="button" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** "Modules / Clients / <current>" breadcrumb for record pages. */
export function RecordBreadcrumb({
  workspaceId,
  module,
  current,
}: {
  workspaceId: string
  module: Module
  current: string
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link to={WORKSPACE_ROUTES.modules(workspaceId)} className="hover:underline">
            Modules
          </Link>
          <span aria-hidden="true"> /</span>
        </li>
        <li>
          <Link to={WORKSPACE_ROUTES.module(workspaceId, module.id)} className="hover:underline">
            {module.name}
          </Link>
          <span aria-hidden="true"> /</span>
        </li>
        <li aria-current="page" className="text-foreground max-w-64 truncate">
          {current}
        </li>
      </ol>
    </nav>
  )
}

/**
 * Loads the module and its field definitions for a record page, with
 * loading, error and "Module not found" states, then renders `children`.
 */
export function RecordPageShell({
  children,
}: {
  children: (context: RecordPageContext) => ReactNode
}) {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { workspace } = useCurrentWorkspace()
  const module = useModule(workspace?.id, moduleId)
  const fields = useFieldDefinitions(workspace?.id, moduleId)

  if (!workspace) return null
  if (module.isPending || (module.data && fields.isPending))
    return <PageSkeleton label="Loading record" />
  if (module.isError) return <LoadError what="The module" onRetry={() => void module.refetch()} />
  if (!module.data) return <ModuleNotFound workspaceId={workspace.id} />
  if (fields.isError) return <LoadError what="The fields" onRetry={() => void fields.refetch()} />
  if (!fields.data) return <PageSkeleton label="Loading record" />

  return <>{children({ workspaceId: workspace.id, module: module.data, fields: fields.data })}</>
}
