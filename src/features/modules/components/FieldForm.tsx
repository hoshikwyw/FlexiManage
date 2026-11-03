import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'

import { FormCheckboxField } from '@/components/shared/form-checkbox-field'
import { FormSelectField } from '@/components/shared/form-select-field'
import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { FIELD_TYPE_DEFINITIONS } from '@/features/records/fields/registry'
import type { FieldDefinition } from '@/types/database'

import { deriveFieldKey } from '../lib/field-key'
import {
  defaultCurrencySettings,
  emptyFieldForm,
  fieldToForm,
  typeUsesCurrency,
  typeUsesOptions,
  typeUsesPrecision,
} from '../lib/field-payload'
import { fieldFormSchema, type FieldFormInput } from '../schemas/field'
import { CurrencySettingsFields } from './CurrencySettingsFields'
import { SelectOptionsEditor } from './SelectOptionsEditor'

interface FieldFormProps {
  /** Existing field when editing; key and type are then locked. */
  field?: FieldDefinition
  pending: boolean
  error: unknown
  errorMessage: (error: unknown) => string
  onSubmit: (values: FieldFormInput) => Promise<void>
  onCancel: () => void
}

const TYPE_LOCK_HINT =
  'The type cannot change once a field exists. To use another type, delete this field and create a new one.'
const KEY_LOCK_HINT = 'The key is fixed after creation; records store values under it.'

/**
 * Label, key, type, required flag and the type-specific parts (options for
 * select; currency and precision for money and numbers). The key follows the
 * label until the user edits it (create only).
 */
export function FieldForm({
  field,
  pending,
  error,
  errorMessage,
  onSubmit,
  onCancel,
}: FieldFormProps) {
  const isEdit = field !== undefined
  const keyEdited = useRef(isEdit)
  const form = useForm<FieldFormInput>({
    resolver: zodResolver(fieldFormSchema),
    defaultValues: field ? fieldToForm(field) : emptyFieldForm(),
  })

  const label = useWatch({ control: form.control, name: 'label' })
  useEffect(() => {
    if (keyEdited.current) return
    const derived = deriveFieldKey(label ?? '')
    if (derived !== form.getValues('key')) {
      form.setValue('key', derived, { shouldValidate: form.formState.isSubmitted })
    }
  }, [form, label])

  const type = useWatch({ control: form.control, name: 'type' })
  useEffect(() => {
    if (isEdit) return
    if (typeUsesCurrency(type) && form.getValues('settings.currency') === '') {
      form.setValue('settings', defaultCurrencySettings())
    }
  }, [form, isEdit, type])

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values)
    } catch {
      // Rendered from `error`.
    }
  })

  return (
    <FormProvider {...form}>
      <form
        onSubmit={submit}
        noValidate
        aria-label={isEdit ? 'Edit field' : 'Add field'}
        className="flex flex-col gap-5"
      >
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="label"
            label="Label"
            placeholder="Due date"
            autoComplete="off"
            autoFocus
          />
          <div
            onInput={() => {
              keyEdited.current = true
            }}
          >
            <FormTextField
              control={form.control}
              name="key"
              label="Key"
              placeholder="due_date"
              autoComplete="off"
              disabled={isEdit}
              description={
                isEdit
                  ? KEY_LOCK_HINT
                  : 'Stored in records; lowercase letters, digits and underscores. Fixed after creation.'
              }
            />
          </div>
          <FormSelectField
            control={form.control}
            name="type"
            label="Type"
            disabled={isEdit}
            description={isEdit ? TYPE_LOCK_HINT : undefined}
            options={FIELD_TYPE_DEFINITIONS.map((definition) => ({
              value: definition.type,
              label: `${definition.label} – ${definition.description}`,
            }))}
          />
          <FormCheckboxField
            control={form.control}
            name="required"
            label="Required"
            description="New and edited records must have a value. Existing records stay readable."
          />
          {typeUsesOptions(type) ? (
            <SelectOptionsEditor
              initialOptions={field ? fieldToForm(field).options : []}
              disabled={pending}
            />
          ) : null}
          {typeUsesPrecision(type) ? (
            <CurrencySettingsFields showCurrency={typeUsesCurrency(type)} />
          ) : null}
        </FieldGroup>
        <FormServerError message={error ? errorMessage(error) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <SubmitButton pending={pending} pendingLabel="Saving...">
            {isEdit ? 'Save field' : 'Add field'}
          </SubmitButton>
        </div>
      </form>
    </FormProvider>
  )
}
