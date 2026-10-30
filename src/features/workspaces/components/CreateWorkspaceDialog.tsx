import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Workspace } from '@/types/database'

import { useCurrentWorkspace } from '../context/workspace-context'
import { WORKSPACE_ROUTES } from '../lib/workspace-routes'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Modal wrapper around `CreateWorkspaceForm`; the new workspace becomes current. */
export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const { setWorkspaceId } = useCurrentWorkspace()
  const navigate = useNavigate()

  function handleCreated(workspace: Workspace) {
    setWorkspaceId(workspace.id)
    onOpenChange(false)
    toast.success(`Workspace "${workspace.name}" created`)
    navigate(WORKSPACE_ROUTES.dashboard(workspace.id))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            You become its owner and can invite people afterwards.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CreateWorkspaceForm
            autoFocus
            onCreated={handleCreated}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
