import { Settings2Icon } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RecordsTab } from '@/features/records/components/RecordsTab'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useModule } from '../api/use-module'
import { FieldsTab } from '../components/FieldsTab'
import { ModuleIcon } from '../components/ModuleIcon'
import { canManageModules } from '../lib/module-permissions'
import { ModuleNotFound } from './ModuleNotFound'

const TABS = ['records', 'fields'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/** `/w/:workspaceId/modules/:moduleId`: header plus Records (table, search, filters) and Fields tabs. */
export function ModulePage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { workspace, role } = useCurrentWorkspace()
  const module = useModule(workspace?.id, moduleId)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'records'
  const canManage = canManageModules(role)

  if (!workspace) return null

  if (module.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading module">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
            <Link to={WORKSPACE_ROUTES.modules(workspace.id)} className="hover:underline">
              Modules
            </Link>
          </nav>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ModuleIcon name={module.data.icon} className="text-muted-foreground size-5 shrink-0" />
            {module.data.name}
          </h1>
          {module.data.description ? (
            <p className="text-muted-foreground text-sm">{module.data.description}</p>
          ) : null}
        </div>
        {canManage ? (
          <Link
            to={WORKSPACE_ROUTES.moduleSettings(workspace.id, module.data.id)}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Settings2Icon aria-hidden="true" />
            Module settings
          </Link>
        ) : null}
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setSearchParams(value === 'records' ? {} : { tab: String(value) }, { replace: true })
        }}
      >
        <TabsList aria-label="Module sections">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
        </TabsList>
        <TabsContent value="records">
          <RecordsTab workspaceId={workspace.id} moduleId={module.data.id} />
        </TabsContent>
        <TabsContent value="fields">
          <FieldsTab workspaceId={workspace.id} moduleId={module.data.id} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
