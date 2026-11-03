import { Input } from '@/components/ui/input'

import { getFieldSettings } from '../field-json'
import { parseNumberInput, stepForPrecision } from '../number-input'
import type { FieldInputProps } from '../types'

function toInputText(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return ''
}

/**
 * Native number input emitting a parsed number (or null). Controlled: React
 * leaves a `type="number"` DOM value alone while it parses to the same number,
 * so intermediate text such as "1." survives re-renders.
 */
export function NumberFieldInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  'aria-describedby': describedBy,
}: FieldInputProps) {
  const { precision } = getFieldSettings(field)
  return (
    <Input
      id={id}
      name={field.key}
      type="number"
      inputMode="decimal"
      step={stepForPrecision(precision)}
      value={toInputText(value)}
      onChange={(event) => onChange(parseNumberInput(event.target.value))}
      onBlur={onBlur}
      disabled={disabled}
      autoComplete="off"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  )
}
