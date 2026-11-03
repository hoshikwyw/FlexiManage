import { Input } from '@/components/ui/input'

import type { FieldInputProps } from '../types'

/** Single-line text; stores the string as typed (trimmed by the schema). */
export function TextFieldInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  'aria-describedby': describedBy,
}: FieldInputProps) {
  return (
    <Input
      id={id}
      name={field.key}
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      maxLength={2000}
      autoComplete="off"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}
