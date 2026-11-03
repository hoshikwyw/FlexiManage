import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'

import type { ApplyTemplateResult } from '../lib/templates'
import { CreateModuleForm } from './CreateModuleForm'

interface CreateModuleDialogProps {
  workspaceId: string
  existingModules: readonly { name: string; slug: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTemplateId?: string
}

/** Modal wrapper around `CreateModuleForm`; opens the new module afterwards. */
export function CreateModuleDialog({
  workspaceId,
  existingModules,
  open,
  onOpenChange,
  defaultTemplateId,
}: CreateModuleDialogProps) {
  const navigate = useNavigate()

  function handleCreated({ module, fields }: ApplyTemplateResult) {
    onOpenChange(false)
    toast.success(
      fields.length > 0
        ? `Module "${module.name}" created with ${fields.length} fields`
        : `Module "${module.name}" created`,
    )
    navigate(WORKSPACE_ROUTES.module(workspaceId, module.id))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New module</DialogTitle>
          <DialogDescription>
            Pick a template or start blank. Fields, options and names can be changed later.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CreateModuleForm
            workspaceId={workspaceId}
            existingModules={existingModules}
            defaultTemplateId={defaultTemplateId}
            onCreated={handleCreated}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
