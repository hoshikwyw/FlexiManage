import { useId } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getSelectOptions } from '@/features/records/fields/field-json'

import type { FilterControlProps } from './filter-control-types'

/** One or more options of a select field (records matching any of them). */
export function OptionsFilterControl({ field, filter, onChange }: FilterControlProps) {
  const id = useId()
  const selected = filter?.kind === 'options' ? filter.values : []
  const options = getSelectOptions(field)

  function toggle(value: string, checked: boolean) {
    const values = checked
      ? options.map((o) => o.value).filter((v) => v === value || selected.includes(v))
      : selected.filter((entry) => entry !== value)
    onChange(values.length ? { kind: 'options', key: field.key, values } : null)
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{field.label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option, index) => (
          <Field key={option.value} orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${id}-${index}`}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked === true)}
            />
            <FieldLabel htmlFor={`${id}-${index}`} className="font-normal">
              {option.label}
            </FieldLabel>
          </Field>
        ))}
      </div>
    </fieldset>
  )
}

/** Yes / No / Any for checkbox fields. */
export function BooleanFilterControl({ field, filter, onChange }: FilterControlProps) {
  const id = useId()
  const value = filter?.kind === 'boolean' ? String(filter.value) : ''
  return (
    <Field>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      <NativeSelect
        id={id}
        className="w-full"
        value={value}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === '' ? null : { kind: 'boolean', key: field.key, value: next === 'true' })
        }}
      >
        <NativeSelectOption value="">Any</NativeSelectOption>
        <NativeSelectOption value="true">Yes</NativeSelectOption>
        <NativeSelectOption value="false">No</NativeSelectOption>
      </NativeSelect>
    </Field>
  )
}
