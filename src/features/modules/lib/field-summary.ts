import { getFieldSettings, getSelectOptions } from '@/features/records/fields/field-json'
import type { FieldDefinition } from '@/types/database'

/** Options or settings in one line: "Lead, Active, Churned", "EUR · 2 decimals". */
export function summariseField(field: FieldDefinition): string {
  if (field.type === 'select') {
    return getSelectOptions(field)
      .map((option) => option.label)
      .join(', ')
  }
  const { currency, precision } = getFieldSettings(field)
  const parts: string[] = []
  if (currency) parts.push(currency)
  if (precision !== undefined) parts.push(`${precision} decimal${precision === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
