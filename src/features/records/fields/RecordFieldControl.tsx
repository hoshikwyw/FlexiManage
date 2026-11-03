import { useId } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import type { FieldDefinition } from '@/types/database'

import { getFieldTypeDefinition } from './registry'

interface RecordFieldControlProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>
  /** Path of the stored value in the form, for example `custom_values.company`. */
  name: FieldPath<TFieldValues>
  field: FieldDefinition
  description?: string
  disabled?: boolean
}

/**
 * One labelled form control for a field definition: label (with a required
 * marker), the registry's input for the field type, description and inline
 * error, wired to React Hook Form through `useController`. Checkbox fields lay
 * out horizontally like the other checkbox forms in the app.
 */
export function RecordFieldControl<TFieldValues extends FieldValues>({
  control,
  name,
  field,
  description,
  disabled,
}: RecordFieldControlProps<TFieldValues>) {
  const id = useId()
  const errorId = `${id}-error`
  const descriptionId = `${id}-description`
  const { field: controller, fieldState } = useController({ control, name })
  const invalid = fieldState.error !== undefined
  const definition = getFieldTypeDefinition(field.type)
  const Input = definition.InputComponent

  const describedBy =
    [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  const label = (
    <FieldLabel htmlFor={id}>
      {field.label}
      {field.required ? (
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      ) : null}
      {field.required ? <span className="sr-only"> (required)</span> : null}
    </FieldLabel>
  )

  return (
    <Field
      data-invalid={invalid || undefined}
      orientation={field.type === 'checkbox' ? 'horizontal' : 'vertical'}
    >
      {field.type === 'checkbox' ? null : label}
      <Input
        id={id}
        field={field}
        value={controller.value}
        onChange={controller.onChange}
        onBlur={controller.onBlur}
        disabled={disabled || controller.disabled}
        invalid={invalid}
        aria-describedby={describedBy}
      />
      {field.type === 'checkbox' ? label : null}
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <FieldError id={errorId} errors={[fieldState.error]} />
    </Field>
  )
}
