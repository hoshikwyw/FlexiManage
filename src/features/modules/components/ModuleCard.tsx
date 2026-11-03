import { Settings2Icon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import { ModuleIcon } from './ModuleIcon'
import type { ModuleSummary } from '../types'

interface ModuleCardProps {
  workspaceId: string
  module: ModuleSummary
  /** Show the "Manage" link (owner/admin). */
  canManage: boolean
}

/** One module: icon, name, description, field count, record count (Part 12) and links. */
export function ModuleCard({ workspaceId, module, canManage }: ModuleCardProps) {
  return (
    <Card data-module-id={module.id} className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ModuleIcon name={module.icon} className="text-muted-foreground size-4 shrink-0" />
          <Link
            to={WORKSPACE_ROUTES.module(workspaceId, module.id)}
            className="focus-visible:ring-ring/50 rounded-sm outline-none hover:underline focus-visible:ring-3"
          >
            {module.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {module.description || 'No description.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <dl className="text-muted-foreground flex gap-4 text-xs">
          <div className="flex gap-1">
            <dt>Fields</dt>
            <dd className="text-foreground font-medium">{module.fieldCount}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Records</dt>
            <dd className="text-foreground font-medium" aria-label="Record count not available yet">
              —
            </dd>
          </div>
        </dl>
        <div className="flex gap-2">
          <Link
            to={WORKSPACE_ROUTES.module(workspaceId, module.id)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Open
          </Link>
          {canManage ? (
            <Link
              to={WORKSPACE_ROUTES.moduleSettings(workspaceId, module.id)}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              aria-label={`Manage ${module.name}`}
            >
              <Settings2Icon aria-hidden="true" />
              Manage
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
