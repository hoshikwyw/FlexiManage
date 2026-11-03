import { getFieldSettings, getSelectOptions } from '@/features/records/fields/field-json'
import type { FieldDefinition, FieldSettings, FieldType, SelectOption } from '@/types/database'

import { DEFAULT_CURRENCY, DEFAULT_CURRENCY_PRECISION, isCurrencyCode } from './currencies'
import type { FieldFormInput } from '../schemas/field'

/** Which types carry which JSON column (docs/architecture.md, JSON shapes). */
export function typeUsesOptions(type: FieldType): boolean {
  return type === 'select'
}

export function typeUsesPrecision(type: FieldType): boolean {
  return type === 'number' || type === 'currency'
}

export function typeUsesCurrency(type: FieldType): boolean {
  return type === 'currency'
}

export interface FieldPayload {
  label: string
  key: string
  type: FieldType
  required: boolean
  options: SelectOption[]
  settings: FieldSettings
}

/**
 * Form values to the columns the database accepts: `options` only for select
 * (otherwise `[]`), `currency` only for currency fields, `precision` only for
 * number and currency. Unknown settings keys are never produced here.
 */
export function toFieldPayload(values: FieldFormInput): FieldPayload {
  const settings: FieldSettings = {}
  if (typeUsesCurrency(values.type) && values.settings.currency !== '') {
    settings.currency = values.settings.currency
  }
  if (typeUsesPrecision(values.type) && values.settings.precision !== '') {
    settings.precision = values.settings.precision
  }
  return {
    label: values.label,
    key: values.key,
    type: values.type,
    required: values.required,
    options: typeUsesOptions(values.type)
      ? values.options.map((option) => ({ value: option.value, label: option.label }))
      : [],
    settings,
  }
}

/** Default form values for a new field of the given type. */
export function emptyFieldForm(type: FieldType = 'text'): FieldFormInput {
  return {
    label: '',
    key: '',
    type,
    required: false,
    options: [],
    settings: { currency: '', precision: '' },
  }
}

/** Form values for editing an existing field (the dialog locks `key` and `type`). */
export function fieldToForm(field: FieldDefinition): FieldFormInput {
  const settings = getFieldSettings(field)
  return {
    label: field.label,
    key: field.key,
    type: field.type,
    required: field.required,
    options: getSelectOptions(field),
    settings: {
      currency: isCurrencyCode(settings.currency) ? settings.currency : '',
      precision: settings.precision ?? '',
    },
  }
}

/** Settings to prefill when the user switches a new field to `currency`. */
export function defaultCurrencySettings(): FieldFormInput['settings'] {
  return { currency: DEFAULT_CURRENCY, precision: DEFAULT_CURRENCY_PRECISION }
}
