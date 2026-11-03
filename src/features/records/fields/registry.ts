import {
  BanknoteIcon,
  CalendarIcon,
  HashIcon,
  ListIcon,
  SquareCheckIcon,
  TypeIcon,
} from 'lucide-react'
import { z, type ZodType } from 'zod'

import { formatDateOnly, parseIsoDate } from '@/lib/format'
import { FIELD_TYPES, type FieldDefinition, type FieldType } from '@/types/database'

import { getFieldSettings, getSelectOptions } from './field-json'
import { CheckboxFieldInput } from './inputs/CheckboxFieldInput'
import { CurrencyFieldInput } from './inputs/CurrencyFieldInput'
import { DateFieldInput } from './inputs/DateFieldInput'
import { NumberFieldInput } from './inputs/NumberFieldInput'
import { parseNumberInput } from './number-input'
import { REMOVED_OPTION_SUFFIX, SelectFieldInput } from './inputs/SelectFieldInput'
import { TextFieldInput } from './inputs/TextFieldInput'
import type { FieldTypeDefinition } from './types'

/** Mirrors `validate_record_custom_values()`: text values are capped at 2,000 characters. */
export const TEXT_MAX_LENGTH = 2000
export const REQUIRED_MESSAGE = 'This field is required'
export const MAX_PRECISION = 6

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/** Zod `error` callback: empty input reads as "required", anything else gets the type hint. */
function typeError(hint: string) {
  return (issue: { input?: unknown }) => (isEmpty(issue.input) ? REQUIRED_MESSAGE : hint)
}

/** Required fields get the base schema; optional ones also accept null and undefined. */
function optionalUnless(required: boolean, base: ZodType): ZodType {
  return required ? base : base.nullish()
}

function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0
  const text = value.toString()
  const exponentIndex = text.indexOf('e-')
  if (exponentIndex !== -1) {
    const mantissa = text.slice(0, exponentIndex).split('.')[1]?.length ?? 0
    return mantissa + Number(text.slice(exponentIndex + 2))
  }
  return text.split('.')[1]?.length ?? 0
}

function numberSchema(field: FieldDefinition, defaultPrecision?: number): ZodType {
  const precision = getFieldSettings(field).precision ?? defaultPrecision
  let schema = z.number({ error: typeError('Enter a number') })
  if (precision !== undefined) {
    schema = schema.refine((value) => decimalPlaces(value) <= precision, {
      error:
        precision === 0
          ? 'Enter a whole number'
          : `Use at most ${precision} decimal place${precision === 1 ? '' : 's'}`,
    }) as typeof schema
  }
  return optionalUnless(field.required, schema)
}

function formatNumber(value: unknown, precision: number | undefined): string {
  if (typeof value !== 'number') return ''
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision ?? MAX_PRECISION,
  }).format(value)
}

function formatCurrency(value: unknown, field: FieldDefinition): string {
  if (typeof value !== 'number') return ''
  const { currency, precision } = getFieldSettings(field)
  const digits = precision ?? 2
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value)
    } catch {
      // Unknown ISO code: fall back to the plain number below.
    }
  }
  return formatNumber(value, digits)
}

const text: FieldTypeDefinition = {
  type: 'text',
  label: 'Text',
  description: 'A line of text, up to 2,000 characters.',
  icon: TypeIcon,
  defaultValue: '',
  zodSchema: (field) => {
    const base = z
      .string({ error: typeError('Enter text') })
      .trim()
      .max(TEXT_MAX_LENGTH, { error: `Use at most ${TEXT_MAX_LENGTH.toLocaleString()} characters` })
    return field.required ? base.min(1, { error: REQUIRED_MESSAGE }) : base.nullish()
  },
  formatValue: (value) => (typeof value === 'string' ? value : ''),
  InputComponent: TextFieldInput,
}

const number: FieldTypeDefinition = {
  type: 'number',
  label: 'Number',
  description: 'A decimal or whole number.',
  icon: HashIcon,
  defaultValue: null,
  zodSchema: (field) => numberSchema(field),
  formatValue: (value, field) => formatNumber(value, getFieldSettings(field).precision),
  parseInput: parseNumberInput,
  InputComponent: NumberFieldInput,
}

const currency: FieldTypeDefinition = {
  type: 'currency',
  label: 'Currency',
  description: 'An amount of money in one currency.',
  icon: BanknoteIcon,
  defaultValue: null,
  zodSchema: (field) => numberSchema(field, 2),
  formatValue: formatCurrency,
  parseInput: parseNumberInput,
  InputComponent: CurrencyFieldInput,
}

const date: FieldTypeDefinition = {
  type: 'date',
  label: 'Date',
  description: 'A calendar date without a time.',
  icon: CalendarIcon,
  defaultValue: null,
  zodSchema: (field) =>
    optionalUnless(
      field.required,
      z.string({ error: typeError('Enter a date') }).superRefine((value, ctx) => {
        if (value === '') ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE })
        else if (!parseIsoDate(value)) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid date (YYYY-MM-DD)' })
        }
      }),
    ),
  formatValue: (value) => (typeof value === 'string' ? formatDateOnly(value) : ''),
  InputComponent: DateFieldInput,
}

const select: FieldTypeDefinition = {
  type: 'select',
  label: 'Select',
  description: 'One option from a list you define.',
  icon: ListIcon,
  defaultValue: null,
  zodSchema: (field) => {
    const values = new Set(getSelectOptions(field).map((option) => option.value))
    return optionalUnless(
      field.required,
      z.string({ error: typeError('Choose an option') }).superRefine((value, ctx) => {
        if (value === '') ctx.addIssue({ code: 'custom', message: REQUIRED_MESSAGE })
        else if (!values.has(value)) {
          ctx.addIssue({ code: 'custom', message: 'Choose one of the current options' })
        }
      }),
    )
  },
  formatValue: (value, field) => {
    if (typeof value !== 'string' || value === '') return ''
    const option = getSelectOptions(field).find((entry) => entry.value === value)
    return option ? option.label : `${value} ${REMOVED_OPTION_SUFFIX}`
  },
  InputComponent: SelectFieldInput,
}

const checkbox: FieldTypeDefinition = {
  type: 'checkbox',
  label: 'Checkbox',
  description: 'Yes or no.',
  icon: SquareCheckIcon,
  defaultValue: false,
  zodSchema: (field) =>
    optionalUnless(field.required, z.boolean({ error: typeError('Tick or untick the box') })),
  formatValue: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
  InputComponent: CheckboxFieldInput,
}

/**
 * The single source of truth for the six MVP field types. Components never
 * switch on `field.type`; they ask `getFieldTypeDefinition(field.type)` for the
 * schema, formatter and input to use.
 */
export const FIELD_TYPE_REGISTRY: Record<FieldType, FieldTypeDefinition> = {
  text,
  number,
  date,
  select,
  checkbox,
  currency,
}

export function getFieldTypeDefinition(type: FieldType): FieldTypeDefinition {
  return FIELD_TYPE_REGISTRY[type]
}

/** Registry entries in the order of the database enum (text, number, date, select, checkbox, currency). */
export const FIELD_TYPE_DEFINITIONS: FieldTypeDefinition[] = FIELD_TYPES.map(
  (type) => FIELD_TYPE_REGISTRY[type],
)

/** Table cell text for one field of a record. */
export function formatFieldValue(value: unknown, field: FieldDefinition): string {
  return FIELD_TYPE_REGISTRY[field.type].formatValue(value, field)
}
