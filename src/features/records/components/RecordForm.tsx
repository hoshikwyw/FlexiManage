import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { Button } from '@/components/ui/button'
import { FieldGroup, FieldSeparator } from '@/components/ui/field'
import { RecordFieldControl } from '@/features/records/fields/RecordFieldControl'
import type { FieldDefinition } from '@/types/database'

import { mapRecordSaveError } from '../lib/record-errors'
import { buildRecordFormSchema, type RecordFormValues } from '../schemas/record'
import { DiscardChangesDialog } from './DiscardChangesDialog'

interface RecordFormProps {
  fields: readonly FieldDefinition[]
  defaultValues: RecordFormValues
  mode: 'create' | 'edit'
  pending: boolean
  /** Saves the parsed values; a rejection is mapped onto the fields or the form. */
  onSubmit: (values: RecordFormValues) => Promise<void>
  onCancel: () => void
  /** The server named a field the form does not know: refetch the definitions. */
  onFieldsStale?: () => void
}

/**
 * Title, status and one registry control per field (module order), validated
 * by `buildRecordFormSchema` before anything is sent. A server 23514
 * `custom_values.<key>: <reason>` lands on that field (also for a required
 * field added after the record was created); everything else, including
 * 42501, is a form-level error. Leaving with unsaved changes asks first.
 */
export function RecordForm({
  fields,
  defaultValues,
  mode,
  pending,
  onSubmit,
  onCancel,
  onFieldsStale,
}: RecordFormProps) {
  const schema = useMemo(() => buildRecordFormSchema(fields), [fields])
  const form = useForm<RecordFormValues>({ resolver: zodResolver(schema), defaultValues })
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const isDirty = form.formState.isDirty

  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const submit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      await onSubmit(values)
    } catch (error) {
      const keys = fields.map((field) => field.key)
      const mapped = mapRecordSaveError(error, keys)
      if (mapped.field) {
        if (!keys.includes(mapped.field.key)) onFieldsStale?.()
        form.setError(
          `custom_values.${mapped.field.key}`,
          { type: 'server', message: mapped.field.message },
          { shouldFocus: true },
        )
      }
      setServerError(mapped.formError)
    }
  })

  function handleCancel() {
    if (isDirty) setConfirmDiscard(true)
    else onCancel()
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label={mode === 'create' ? 'New record' : 'Edit record'}
      className="flex max-w-2xl flex-col gap-5"
    >
      <FieldGroup>
        <FormTextField
          control={form.control}
          name="title"
          label="Title"
          autoComplete="off"
          autoFocus
        />
        <FormTextField
          control={form.control}
          name="status"
          label="Record status"
          autoComplete="off"
          description="Optional free text, up to 50 characters."
        />
        {fields.length > 0 ? <FieldSeparator /> : null}
        {fields.map((field) => (
          <RecordFieldControl
            key={field.id}
            control={form.control}
            name={`custom_values.${field.key}`}
            field={field}
          />
        ))}
      </FieldGroup>

      <FormServerError message={serverError} />

      {/* Part 13: attachment upload slot for new records (after the first save). */}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} pendingLabel="Saving...">
          {mode === 'create' ? 'Create record' : 'Save changes'}
        </SubmitButton>
        <Button type="button" variant="outline" onClick={handleCancel} disabled={pending}>
          Cancel
        </Button>
      </div>

      <DiscardChangesDialog
        open={confirmDiscard}
        onKeepEditing={() => setConfirmDiscard(false)}
        onDiscard={() => {
          setConfirmDiscard(false)
          onCancel()
        }}
      />
    </form>
  )
}
