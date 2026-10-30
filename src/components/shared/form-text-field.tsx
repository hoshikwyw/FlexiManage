import { useId } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface FormTextFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  label: string
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  placeholder?: string
  description?: string
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * Labelled text input wired to React Hook Form through `useController`.
 * Controlled on purpose: the shadcn `Input` wrapper does not forward refs on
 * React 18, so `register()` could not attach to the DOM node.
 */
export function FormTextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  description,
  disabled,
  autoFocus,
}: FormTextFieldProps<TFieldValues>) {
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
      <Input
        id={id}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
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
