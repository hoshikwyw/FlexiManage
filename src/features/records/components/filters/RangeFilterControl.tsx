import { useId } from 'react'

import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { parseIsoDate } from '@/lib/format'

import type { RecordFilter } from '../../types'
import { useFilterDraft, type FilterControlProps } from './filter-control-types'

type RangeKind = 'number-range' | 'date-range'

interface RangeDraft {
  min: string
  max: string
}

function toDraft(filter: RecordFilter | undefined, kind: RangeKind): RangeDraft {
  if (filter?.kind !== kind) return { min: '', max: '' }
  return {
    min: filter.min === null ? '' : String(filter.min),
    max: filter.max === null ? '' : String(filter.max),
  }
}

function parseSide(raw: string, kind: RangeKind): number | string | null | undefined {
  const value = raw.trim()
  if (value === '') return null
  if (kind === 'date-range') return parseIsoDate(value) ? value : undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildFilter(
  key: string,
  kind: RangeKind,
  draft: RangeDraft,
): RecordFilter | null | undefined {
  const min = parseSide(draft.min, kind)
  const max = parseSide(draft.max, kind)
  if (min === undefined || max === undefined) return undefined // invalid input: keep the draft
  if (min === null && max === null) return null
  return kind === 'number-range'
    ? { kind, key, min: min as number | null, max: max as number | null }
    : { kind, key, min: min as string | null, max: max as string | null }
}

/** Between min and max (either optional) for number, currency and date fields. */
function RangeFilterControl({
  field,
  filter,
  onChange,
  kind,
}: FilterControlProps & { kind: RangeKind }) {
  const id = useId()
  const [draft, setDraft] = useFilterDraft(filter, () => toDraft(filter, kind))
  const inputType = kind === 'date-range' ? 'date' : 'number'

  function commit(next: RangeDraft = draft) {
    const built = buildFilter(field.key, kind, next)
    if (built === undefined) return
    const current = toDraft(filter, kind)
    const normalised = toDraft(built ?? undefined, kind)
    if (normalised.min === current.min && normalised.max === current.max) return
    onChange(built)
  }

  const sides = [
    { side: 'min' as const, label: kind === 'date-range' ? 'From' : 'Min' },
    { side: 'max' as const, label: kind === 'date-range' ? 'To' : 'Max' },
  ]

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{field.label}</legend>
      <div className="flex gap-2">
        {sides.map(({ side, label }) => (
          <Field key={side} className="min-w-0 flex-1">
            <FieldLabel htmlFor={`${id}-${side}`} className="text-muted-foreground text-xs">
              <span>{label}</span>
              <span className="sr-only"> {field.label}</span>
            </FieldLabel>
            <Input
              id={`${id}-${side}`}
              type={inputType}
              inputMode={kind === 'number-range' ? 'decimal' : undefined}
              step={kind === 'number-range' ? 'any' : undefined}
              value={draft[side]}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, [side]: event.target.value })}
              onBlur={() => commit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit()
                }
              }}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  )
}

export function NumberRangeFilterControl(props: FilterControlProps) {
  return <RangeFilterControl {...props} kind="number-range" />
}

export function DateRangeFilterControl(props: FilterControlProps) {
  return <RangeFilterControl {...props} kind="date-range" />
}
