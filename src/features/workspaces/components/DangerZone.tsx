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
import type { Workspace } from '@/types/database'

import { useDeleteWorkspace } from '../api/use-delete-workspace'
import { getWorkspaceErrorMessage } from '../lib/workspace-errors'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'

/** Owner-only destructive actions. Deleting asks the user to type the workspace name. */
export function DangerZone({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting a workspace removes its members, invitations and activity. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
        <DeleteWorkspaceDialog workspace={workspace} open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  )
}

function DeleteWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const inputId = useId()
  const [confirmation, setConfirmation] = useState('')
  const deleteWorkspace = useDeleteWorkspace()
  const navigate = useNavigate()
  const matches = confirmation.trim() === workspace.name

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmation('')
      deleteWorkspace.reset()
    }
    onOpenChange(next)
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!matches) return
    try {
      await deleteWorkspace.mutateAsync(workspace.id)
      onOpenChange(false)
      toast.success(`Workspace "${workspace.name}" deleted`)
      navigate(WORKSPACE_ROUTES.root, { replace: true })
    } catch {
      // Rendered from `deleteWorkspace.error`.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void handleDelete(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete {workspace.name}?</DialogTitle>
            <DialogDescription>
              All members lose access immediately and the data is deleted permanently.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={inputId}>Type the workspace name to confirm</FieldLabel>
            <Input
              id={inputId}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              placeholder={workspace.name}
              aria-describedby={`${inputId}-hint`}
            />
            <FieldDescription id={`${inputId}-hint`}>
              Expected: <span className="text-foreground font-medium">{workspace.name}</span>
            </FieldDescription>
          </Field>
          <FormServerError
            message={deleteWorkspace.error ? getWorkspaceErrorMessage(deleteWorkspace.error) : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton
              variant="destructive"
              pending={deleteWorkspace.isPending}
              pendingLabel="Deleting..."
              disabled={!matches}
            >
              Delete workspace
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
