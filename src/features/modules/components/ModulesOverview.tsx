import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRecordCounts } from '@/features/records/api/use-record-counts'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { useModules } from '../api/use-modules'
import { ModuleIcon } from './ModuleIcon'

/** Dashboard card body: the workspace's modules as links (field and record counts), plus a link to the list. */
export function ModulesOverview({ workspaceId }: { workspaceId: string }) {
  const modules = useModules(workspaceId)
  const recordCounts = useRecordCounts(workspaceId)

  if (modules.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading modules">
        {Array.from({ length: 2 }, (_, index) => (
          <li key={index}>
            <Skeleton className="h-8 w-full" />
          </li>
        ))}
      </ul>
    )
  }

  if (modules.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-destructive">Modules could not be loaded.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void modules.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {modules.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No modules yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Your modules">
          {modules.data.map((module) => {
            const records = recordCounts.data?.[module.id]
            return (
              <li key={module.id}>
                <Link
                  to={WORKSPACE_ROUTES.module(workspaceId, module.id)}
                  className="focus-visible:ring-ring/50 hover:bg-muted flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm outline-none focus-visible:ring-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ModuleIcon
                      name={module.icon}
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="truncate">{module.name}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {module.fieldCount} {module.fieldCount === 1 ? 'field' : 'fields'}
                    {records === undefined
                      ? null
                      : ` · ${records.toLocaleString()} ${records === 1 ? 'record' : 'records'}`}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <div>
        <Link
          to={WORKSPACE_ROUTES.modules(workspaceId)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {modules.data.length === 0 ? 'Set up modules' : 'All modules'}
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
