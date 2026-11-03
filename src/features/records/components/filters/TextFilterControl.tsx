import { useId } from 'react'

import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { useFilterDraft, type FilterControlProps } from './filter-control-types'

/** "Contains" filter for text fields; applied on Enter or when the input loses focus. */
export function TextFilterControl({ field, filter, onChange }: FilterControlProps) {
  const id = useId()
  const [draft, setDraft] = useFilterDraft(filter, () =>
    filter?.kind === 'text' ? filter.value : '',
  )

  function commit() {
    const value = draft.trim()
    const current = filter?.kind === 'text' ? filter.value : ''
    if (value === current) return
    onChange(value ? { kind: 'text', key: field.key, value } : null)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{field.label} contains</FieldLabel>
      <Input
        id={id}
        type="search"
        value={draft}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
    </Field>
  )
}
