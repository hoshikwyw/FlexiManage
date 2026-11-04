import { toast } from 'sonner'

import { FormServerError } from '@/components/shared/form-server-error'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import { useDeleteAttachment } from '../api/use-delete-attachment'
import { getAttachmentErrorMessage } from '../lib/storage-errors'
import type { AttachmentRow } from '../types'

interface DeleteAttachmentDialogProps {
  workspaceId: string
  recordId: string
  /** The file to delete; null keeps the dialog closed. */
  attachment: Pick<AttachmentRow, 'id' | 'file_name'> | null
  onClose: () => void
}

/** Confirms removing one file. Failures stay in the dialog as an alert. */
export function DeleteAttachmentDialog({
  workspaceId,
  recordId,
  attachment,
  onClose,
}: DeleteAttachmentDialogProps) {
  const deleteAttachment = useDeleteAttachment(workspaceId, recordId)

  async function handleDelete() {
    if (!attachment) return
    try {
      await deleteAttachment.mutateAsync({ id: attachment.id })
      toast.success(`"${attachment.file_name}" deleted`)
      deleteAttachment.reset()
      onClose()
    } catch {
      // Rendered below from `deleteAttachment.error`.
    }
  }

  function handleOpenChange(open: boolean) {
    if (open) return
    deleteAttachment.reset()
    onClose()
  }

  return (
    <AlertDialog open={attachment !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {attachment?.file_name ?? 'this file'}?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is removed from this record for everyone in the workspace. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormServerError
          message={
            deleteAttachment.error ? getAttachmentErrorMessage(deleteAttachment.error) : null
          }
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteAttachment.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteAttachment.isPending}
            onClick={() => void handleDelete()}
          >
            {deleteAttachment.isPending ? 'Deleting...' : 'Delete file'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
