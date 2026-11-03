import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useCurrentWorkspace } from '@/features/workspaces/context/workspace-context'

import { useModules } from '../api/use-modules'
import { CreateModuleDialog } from '../components/CreateModuleDialog'
import { ModulesList, ModulesListSkeleton } from '../components/ModulesList'
import { ModuleUsageBadge } from '../components/ModuleUsageBadge'
import { canManageModules } from '../lib/module-permissions'
import { BLANK_TEMPLATE_ID, DEFAULT_TEMPLATE_ID } from '../lib/templates'

/** `/w/:workspaceId/modules`: every module of the workspace, create dialog for owners and admins. */
export function ModulesPage() {
  const { workspace, role } = useCurrentWorkspace()
  const modules = useModules(workspace?.id)
  const [dialog, setDialog] = useState<{ open: boolean; templateId: string }>({
    open: false,
    templateId: BLANK_TEMPLATE_ID,
  })
  const canManage = canManageModules(role)

  if (!workspace) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            Modules
            <ModuleUsageBadge workspaceId={workspace.id} />
          </h1>
          <p className="text-muted-foreground text-sm">
            What {workspace.name} keeps track of: each module has its own fields and records.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            onClick={() => setDialog({ open: true, templateId: BLANK_TEMPLATE_ID })}
          >
            <PlusIcon aria-hidden="true" />
            New module
          </Button>
        ) : null}
      </div>

      {modules.isPending ? (
        <ModulesListSkeleton />
      ) : modules.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm">
          <p className="text-destructive">Modules could not be loaded.</p>
          <Button type="button" variant="outline" onClick={() => void modules.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <ModulesList
          workspaceId={workspace.id}
          modules={modules.data}
          canManage={canManage}
          onStartFromTemplate={() => setDialog({ open: true, templateId: DEFAULT_TEMPLATE_ID })}
        />
      )}

      {canManage ? (
        <CreateModuleDialog
          key={dialog.templateId}
          workspaceId={workspace.id}
          existingModules={modules.data ?? []}
          open={dialog.open}
          onOpenChange={(open) => setDialog((state) => ({ ...state, open }))}
          defaultTemplateId={dialog.templateId}
        />
      ) : null}
    </div>
  )
}
