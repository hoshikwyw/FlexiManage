import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FieldDefinition } from '@/types/database'

import { useCreateField } from '../api/use-create-field'
import { useUpdateField } from '../api/use-update-field'
import { toFieldPayload } from '../lib/field-payload'
import { getModuleErrorMessage } from '../lib/module-errors'
import type { FieldFormInput } from '../schemas/field'
import { FieldForm } from './FieldForm'

interface FieldDialogProps {
  workspaceId: string
  moduleId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this field; omit to create one. */
  field?: FieldDefinition
  /** Position for a new field (the current count). */
  nextPosition: number
}

/** Create or edit a field definition. The form remounts on every open so state never leaks. */
export function FieldDialog({
  workspaceId,
  moduleId,
  open,
  onOpenChange,
  field,
  nextPosition,
}: FieldDialogProps) {
  const createField = useCreateField(workspaceId, moduleId)
  const updateField = useUpdateField(workspaceId, moduleId)
  const isEdit = field !== undefined
  const mutation = isEdit ? updateField : createField

  function handleOpenChange(next: boolean) {
    if (!next) {
      createField.reset()
      updateField.reset()
    }
    onOpenChange(next)
  }

  async function handleSubmit(values: FieldFormInput) {
    const payload = toFieldPayload(values)
    if (field) {
      await updateField.mutateAsync({
        fieldId: field.id,
        label: payload.label,
        required: payload.required,
        options: payload.options,
        settings: payload.settings,
      })
      toast.success(`Field "${payload.label}" saved`)
    } else {
      await createField.mutateAsync({ ...payload, position: nextPosition })
      toast.success(`Field "${payload.label}" added`)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${field.label}` : 'Add field'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Change the label, required flag and type-specific settings.'
              : 'Fields define what each record of this module stores.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <FieldForm
            key={field?.id ?? 'new'}
            field={field}
            pending={mutation.isPending}
            error={mutation.error}
            errorMessage={getModuleErrorMessage}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
