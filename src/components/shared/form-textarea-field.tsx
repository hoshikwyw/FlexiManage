import { useId } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

interface FormTextareaFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  label: string
  placeholder?: string
  description?: string
  disabled?: boolean
  rows?: number
  maxLength?: number
}

/** Labelled multi-line text wired to React Hook Form (same contract as `FormTextField`). */
export function FormTextareaField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  description,
  disabled,
  rows = 3,
  maxLength,
}: FormTextareaFieldProps<TFieldValues>) {
  const id = useId()
  const errorId = `${id}-error`
  const descriptionId = `${id}-description`
  const { field, fieldState } = useController({ control, name })
  const invalid = fieldState.error !== undefined

  const describedBy =
    [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={field.name}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled || field.disabled}
        value={(field.value as string | undefined) ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <FieldError id={errorId} errors={[fieldState.error]} />
    </Field>
  )
}
