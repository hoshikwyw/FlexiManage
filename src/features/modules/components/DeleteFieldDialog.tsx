import { toast } from 'sonner'

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
import type { FieldDefinition } from '@/types/database'

import { useDeleteField } from '../api/use-delete-field'
import { getModuleErrorMessage } from '../lib/module-errors'

interface DeleteFieldDialogProps {
  workspaceId: string
  moduleId: string
  field: FieldDefinition | null
  onClose: () => void
}

/** Confirms deleting a field and warns that its values disappear from every record. */
export function DeleteFieldDialog({
  workspaceId,
  moduleId,
  field,
  onClose,
}: DeleteFieldDialogProps) {
  const deleteField = useDeleteField(workspaceId, moduleId)

  async function handleDelete() {
    if (!field) return
    try {
      await deleteField.mutateAsync(field.id)
      toast.success(`Field "${field.label}" deleted`)
      onClose()
    } catch (error) {
      toast.error(getModuleErrorMessage(error))
    }
  }

  return (
    <AlertDialog open={field !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {field?.label ?? 'this field'}?</AlertDialogTitle>
          <AlertDialogDescription>
            The field disappears from forms, tables and exports, and the values stored under &ldquo;
            {field?.key}&rdquo; are removed from every record of this module. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteField.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteField.isPending}
            onClick={() => void handleDelete()}
          >
            {deleteField.isPending ? 'Deleting...' : 'Delete field'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
