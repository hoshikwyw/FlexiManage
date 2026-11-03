import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { FormServerError } from '@/components/shared/form-server-error'
import { SubmitButton } from '@/components/shared/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { WORKSPACE_ROUTES } from '@/features/workspaces/lib/workspace-routes'
import type { Module } from '@/types/database'

import { useDeleteModule } from '../api/use-delete-module'
import { getModuleErrorMessage } from '../lib/module-errors'

interface DeleteModuleProps {
  workspaceId: string
  module: Module
}

/** Owner/admin destructive action for one module; opens the typed-name confirmation. */
export function ModuleDangerZone({ workspaceId, module }: DeleteModuleProps) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting a module removes all of its fields and records. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          Delete module
        </Button>
        <DeleteModuleDialog
          workspaceId={workspaceId}
          module={module}
          open={open}
          onOpenChange={setOpen}
        />
      </CardContent>
    </Card>
  )
}

/** Deletes after the user types the module name; navigates to the list before the refetch. */
export function DeleteModuleDialog({
  workspaceId,
  module,
  open,
  onOpenChange,
}: DeleteModuleProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const inputId = useId()
  const [confirmation, setConfirmation] = useState('')
  const deleteModule = useDeleteModule(workspaceId)
  const navigate = useNavigate()
  const matches = confirmation.trim() === module.name

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmation('')
      deleteModule.reset()
    }
    onOpenChange(next)
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!matches) return
    try {
      await deleteModule.mutateAsync(module.id)
      navigate(WORKSPACE_ROUTES.modules(workspaceId), { replace: true })
      onOpenChange(false)
      toast.success(`Module "${module.name}" deleted`)
    } catch {
      // Rendered from `deleteModule.error`.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void handleDelete(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete {module.name}?</DialogTitle>
            <DialogDescription>
              Every field definition and every record of this module is deleted permanently.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={inputId}>Type the module name to confirm</FieldLabel>
            <Input
              id={inputId}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              placeholder={module.name}
              aria-describedby={`${inputId}-hint`}
            />
            <FieldDescription id={`${inputId}-hint`}>
              Expected: <span className="text-foreground font-medium">{module.name}</span>
            </FieldDescription>
          </Field>
          <FormServerError
            message={deleteModule.error ? getModuleErrorMessage(deleteModule.error) : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton
              variant="destructive"
              pending={deleteModule.isPending}
              pendingLabel="Deleting..."
              disabled={!matches}
            >
              Delete module
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
