import type { FieldDefinition, FieldSettings, SelectOption } from '@/types/database'

/**
 * Narrowers for the JSONB columns of `field_definitions`. The database
 * constraints guarantee the shapes documented in docs/architecture.md, but the
 * generated type is `Json`, so every reader goes through these helpers instead
 * of casting.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `options` of a select field as typed entries; `[]` for every other type or malformed data. */
export function getSelectOptions(field: Pick<FieldDefinition, 'options'>): SelectOption[] {
  if (!Array.isArray(field.options)) return []
  const options: SelectOption[] = []
  for (const entry of field.options) {
    if (isRecord(entry) && typeof entry.value === 'string' && typeof entry.label === 'string') {
      options.push({ value: entry.value, label: entry.label })
    }
  }
  return options
}

/** Known `settings` keys with their types checked; unknown keys are dropped. */
export function getFieldSettings(field: Pick<FieldDefinition, 'settings'>): FieldSettings {
  if (!isRecord(field.settings)) return {}
  const settings: FieldSettings = {}
  if (typeof field.settings.currency === 'string') settings.currency = field.settings.currency
  if (typeof field.settings.precision === 'number' && Number.isInteger(field.settings.precision)) {
    settings.precision = field.settings.precision
  }
  return settings
}

/** Options as plain JSON for an insert or update (`SelectOption` has no index signature). */
export function toOptionsJson(
  options: readonly SelectOption[],
): { value: string; label: string }[] {
  return options.map(({ value, label }) => ({ value, label }))
}
