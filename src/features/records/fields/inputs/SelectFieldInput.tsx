import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { getSelectOptions } from '../field-json'
import type { FieldInputProps } from '../types'

export const REMOVED_OPTION_SUFFIX = '(removed option)'

/**
 * Native select over the field's current options. A stored value whose option
 * was removed is still listed (marked "(removed option)") so the form shows
 * what the record holds; picking anything else drops it for good.
 */
export function SelectFieldInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  'aria-describedby': describedBy,
}: FieldInputProps) {
  const options = getSelectOptions(field)
  const current = typeof value === 'string' ? value : ''
  const isRemoved = current !== '' && !options.some((option) => option.value === current)

  return (
    <NativeSelect
      className="w-full"
      id={id}
      name={field.key}
      value={current}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <NativeSelectOption value="">{field.required ? 'Choose...' : 'None'}</NativeSelectOption>
      {isRemoved ? (
        <NativeSelectOption value={current}>
          {current} {REMOVED_OPTION_SUFFIX}
        </NativeSelectOption>
      ) : null}
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
