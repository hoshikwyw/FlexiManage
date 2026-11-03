import { Input } from '@/components/ui/input'

import type { FieldInputProps } from '../types'

/** Native date input; the browser already speaks `YYYY-MM-DD`. Empty becomes null. */
export function DateFieldInput({
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
      type="date"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      autoComplete="off"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}
