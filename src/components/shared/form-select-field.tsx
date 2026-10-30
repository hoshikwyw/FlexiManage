import { useId } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export interface SelectOption {
  value: string
  label: string
}

interface FormSelectFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  label: string
  options: SelectOption[]
  description?: string
  disabled?: boolean
}

/**
 * Labelled native `<select>` wired to React Hook Form through `useController`
 * (the shadcn wrapper does not forward refs on React 18, so `register()` cannot
 * reach the DOM node). Native so it is keyboard and screen-reader friendly
 * without extra wiring.
 */
export function FormSelectField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  options,
  description,
  disabled,
}: FormSelectFieldProps<TFieldValues>) {
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
      <NativeSelect
        className="w-full"
        id={id}
        name={field.name}
        disabled={disabled || field.disabled}
        value={(field.value as string | undefined) ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <FieldError id={errorId} errors={[fieldState.error]} />
    </Field>
  )
}
