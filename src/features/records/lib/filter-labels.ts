import { formatFieldValue } from '@/features/records/fields/registry'
import type { FieldDefinition } from '@/types/database'

import type { RecordFilter } from '../types'

function formatRange(
  field: FieldDefinition,
  min: number | string | null,
  max: number | string | null,
): string {
  const low = min === null ? null : formatFieldValue(min, field) || String(min)
  const high = max === null ? null : formatFieldValue(max, field) || String(max)
  if (low !== null && high !== null) return `${low} to ${high}`
  if (low !== null) return `at least ${low}`
  return `at most ${high ?? ''}`
}

/** Chip text for an active filter, for example `Status: Lead, Active` or `Value: at least €100.00`. */
export function describeFilter(filter: RecordFilter, field: FieldDefinition): string {
  switch (filter.kind) {
    case 'text':
      return `${field.label} contains "${filter.value}"`
    case 'options':
      return `${field.label}: ${filter.values.map((value) => formatFieldValue(value, field)).join(', ')}`
    case 'boolean':
      return `${field.label}: ${filter.value ? 'Yes' : 'No'}`
    case 'number-range':
    case 'date-range':
      return `${field.label}: ${formatRange(field, filter.min, filter.max)}`
  }
}
