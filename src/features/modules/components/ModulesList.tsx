import { LayoutTemplateIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { ModuleSummary } from '../types'
import { ModuleCard } from './ModuleCard'

interface ModulesListProps {
  workspaceId: string
  modules: ModuleSummary[]
  canManage: boolean
  /** Opens the create dialog with the template picker (empty state, owner/admin). */
  onStartFromTemplate?: () => void
}

/** Cards for every module, or the empty state. */
export function ModulesList({
  workspaceId,
  modules,
  canManage,
  onStartFromTemplate,
}: ModulesListProps) {
  if (modules.length === 0) {
    return <ModulesEmptyState canManage={canManage} onStartFromTemplate={onStartFromTemplate} />
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Modules">
      {modules.map((module) => (
        <li key={module.id} className="flex">
          <div className="flex w-full">
            <ModuleCard workspaceId={workspaceId} module={module} canManage={canManage} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ModulesEmptyState({
  canManage,
  onStartFromTemplate,
}: Pick<ModulesListProps, 'canManage' | 'onStartFromTemplate'>) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <LayoutTemplateIcon className="text-muted-foreground size-8" aria-hidden="true" />
        <h2 className="text-lg font-semibold tracking-tight">No modules yet</h2>
        <p className="text-muted-foreground max-w-md text-sm">
          {canManage
            ? 'A module is a type of thing you track, such as tasks, clients or rooms. Start from a template to get a ready-made set of fields, or create a blank one.'
            : 'A module is a type of thing your team tracks. An owner or admin can create the first one.'}
        </p>
        {canManage && onStartFromTemplate ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={onStartFromTemplate}>
              <PlusIcon aria-hidden="true" />
              Start from a template
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ModulesListSkeleton() {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-label="Loading modules"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-3 py-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
