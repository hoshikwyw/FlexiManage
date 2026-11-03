import { useId } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'

interface FormCheckboxFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  label: string
  description?: string
  disabled?: boolean
}

/** Labelled checkbox (boolean field) wired to React Hook Form. */
export function FormCheckboxField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
}: FormCheckboxFieldProps<TFieldValues>) {
  const id = useId()
  const errorId = `${id}-error`
  const descriptionId = `${id}-description`
  const { field, fieldState } = useController({ control, name })
  const invalid = fieldState.error !== undefined

  const describedBy =
    [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <Field orientation="horizontal" data-invalid={invalid || undefined}>
      <Checkbox
        id={id}
        name={field.name}
        checked={field.value === true}
        onCheckedChange={(checked) => field.onChange(checked === true)}
        onBlur={field.onBlur}
        disabled={disabled || field.disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        <FieldError id={errorId} errors={[fieldState.error]} />
      </FieldContent>
    </Field>
  )
}
