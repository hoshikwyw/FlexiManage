import { Checkbox } from '@/components/ui/checkbox'

import type { FieldInputProps } from '../types'

/** Checkbox storing a boolean; "no value" (null) renders unchecked and becomes false on first toggle. */
export function CheckboxFieldInput({
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
    <Checkbox
      id={id}
      name={field.key}
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked === true)}
      onBlur={onBlur}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}
