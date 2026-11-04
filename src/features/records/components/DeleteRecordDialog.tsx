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

import { useDeleteRecord } from '../api/use-delete-record'
import { getRecordErrorMessage } from '../lib/record-errors'
import type { RecordItem } from '../types'

interface DeleteRecordDialogProps {
  workspaceId: string
  moduleId: string
  /** The record to delete; null keeps the dialog closed. */
  record: Pick<RecordItem, 'id' | 'title'> | null
  onClose: () => void
  /** Called after the delete succeeded (navigate away from the record). */
  onDeleted: () => void
}

/** Confirms deleting one record. Failures stay in the dialog as an alert. */
export function DeleteRecordDialog({
  workspaceId,
  moduleId,
  record,
  onClose,
  onDeleted,
}: DeleteRecordDialogProps) {
  const deleteRecord = useDeleteRecord(workspaceId, moduleId)

  async function handleDelete() {
    if (!record) return
    try {
      await deleteRecord.mutateAsync(record.id)
      toast.success(`Record "${record.title}" deleted`)
      onDeleted()
    } catch {
      // Rendered below from `deleteRecord.error`.
    }
  }

  function handleOpenChange(open: boolean) {
    if (open) return
    deleteRecord.reset()
    onClose()
  }

  return (
    <AlertDialog open={record !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {record?.title ?? 'this record'}?</AlertDialogTitle>
          <AlertDialogDescription>
            The record, its values and its attachments are removed for everyone in this workspace.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormServerError
          message={deleteRecord.error ? getRecordErrorMessage(deleteRecord.error) : null}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteRecord.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteRecord.isPending}
            onClick={() => void handleDelete()}
          >
            {deleteRecord.isPending ? 'Deleting...' : 'Delete record'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
