import { describe, expect, it } from 'vitest'

import { createTestField } from '@/test/fields'
import { FIELD_TYPES } from '@/types/database'

import {
  FIELD_TYPE_DEFINITIONS,
  FIELD_TYPE_REGISTRY,
  NUMBER_OUT_OF_RANGE_MESSAGE,
  REQUIRED_MESSAGE,
  TEXT_MAX_LENGTH,
  formatFieldValue,
} from './registry'

function messagesOf(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? [])
}

describe('FIELD_TYPE_REGISTRY', () => {
  it('has one definition per database field type, in enum order', () => {
    expect(Object.keys(FIELD_TYPE_REGISTRY).sort()).toEqual([...FIELD_TYPES].sort())
    expect(FIELD_TYPE_DEFINITIONS.map((d) => d.type)).toEqual([...FIELD_TYPES])
    for (const definition of FIELD_TYPE_DEFINITIONS) {
      expect(definition.label).toBeTruthy()
      expect(typeof definition.InputComponent).toBe('function')
    }
  })

  it('starts text at "", checkbox at false and the rest at null', () => {
    expect(FIELD_TYPE_REGISTRY.text.defaultValue).toBe('')
    expect(FIELD_TYPE_REGISTRY.checkbox.defaultValue).toBe(false)
    for (const type of ['number', 'currency', 'date', 'select'] as const) {
      expect(FIELD_TYPE_REGISTRY[type].defaultValue).toBeNull()
    }
  })
})

describe('text schema', () => {
  const required = FIELD_TYPE_REGISTRY.text.zodSchema(createTestField({ required: true }))
  const optional = FIELD_TYPE_REGISTRY.text.zodSchema(createTestField({ required: false }))

  it('accepts text up to 2,000 characters and trims it', () => {
    expect(required.parse('  Acme  ')).toBe('Acme')
    expect(required.safeParse('a'.repeat(TEXT_MAX_LENGTH)).success).toBe(true)
    expect(messagesOf(required.safeParse('a'.repeat(TEXT_MAX_LENGTH + 1)))).toEqual([
      'Use at most 2,000 characters',
    ])
  })

  it('treats empty, blank and null as missing when required', () => {
    expect(messagesOf(required.safeParse(''))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse('   '))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse(null))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse(undefined))).toEqual([REQUIRED_MESSAGE])
  })

  it('accepts null, undefined and "" when optional and rejects non-strings', () => {
    expect(optional.safeParse(null).success).toBe(true)
    expect(optional.safeParse(undefined).success).toBe(true)
    expect(optional.safeParse('').success).toBe(true)
    expect(messagesOf(optional.safeParse(42))).toEqual(['Enter text'])
  })
})

describe('number and currency schemas', () => {
  it('accepts finite numbers and rejects strings, NaN and Infinity', () => {
    const schema = FIELD_TYPE_REGISTRY.number.zodSchema(createTestField({ type: 'number' }))
    expect(schema.safeParse(12.5).success).toBe(true)
    expect(schema.safeParse(-3).success).toBe(true)
    expect(messagesOf(schema.safeParse('12'))).toEqual(['Enter a number'])
    expect(schema.safeParse(Number.NaN).success).toBe(false)
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
  })

  it('requires a value when required and allows null when optional', () => {
    const required = FIELD_TYPE_REGISTRY.number.zodSchema(
      createTestField({ type: 'number', required: true }),
    )
    const optional = FIELD_TYPE_REGISTRY.number.zodSchema(createTestField({ type: 'number' }))
    expect(messagesOf(required.safeParse(null))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse(''))).toEqual([REQUIRED_MESSAGE])
    expect(optional.safeParse(null).success).toBe(true)
    expect(optional.safeParse(undefined).success).toBe(true)
  })

  it('enforces the precision setting on numbers', () => {
    const whole = FIELD_TYPE_REGISTRY.number.zodSchema(
      createTestField({ type: 'number', settings: { precision: 0 } }),
    )
    expect(whole.safeParse(3).success).toBe(true)
    expect(messagesOf(whole.safeParse(3.5))).toEqual(['Enter a whole number'])
    const one = FIELD_TYPE_REGISTRY.number.zodSchema(
      createTestField({ type: 'number', settings: { precision: 1 } }),
    )
    expect(one.safeParse(3.5).success).toBe(true)
    expect(messagesOf(one.safeParse(3.55))).toEqual(['Use at most 1 decimal place'])
  })

  it('defaults currency to two decimals and honours an explicit precision', () => {
    const eur = FIELD_TYPE_REGISTRY.currency.zodSchema(
      createTestField({ type: 'currency', settings: { currency: 'EUR' } }),
    )
    expect(eur.safeParse(1234.5).success).toBe(true)
    expect(messagesOf(eur.safeParse(1.234))).toEqual(['Use at most 2 decimal places'])
    const jpy = FIELD_TYPE_REGISTRY.currency.zodSchema(
      createTestField({ type: 'currency', settings: { currency: 'JPY', precision: 0 } }),
    )
    expect(jpy.safeParse(100).success).toBe(true)
    expect(jpy.safeParse(100.5).success).toBe(false)
  })

  it.each(['number', 'currency'] as const)(
    '%s rejects abs(x) >= 1e15 and more than 6 fractional digits like the server',
    (type) => {
      // No precision cap of the field's own, so only the server limits apply.
      const schema = FIELD_TYPE_REGISTRY[type].zodSchema(
        createTestField({ type, settings: { precision: 6 } }),
      )
      expect(schema.safeParse(999_999_999_999_999).success).toBe(true)
      expect(schema.safeParse(-999_999_999_999_999).success).toBe(true)
      expect(schema.safeParse(0.123456).success).toBe(true)
      expect(messagesOf(schema.safeParse(1e15))).toEqual([NUMBER_OUT_OF_RANGE_MESSAGE])
      expect(messagesOf(schema.safeParse(-1e15))).toEqual([NUMBER_OUT_OF_RANGE_MESSAGE])
      expect(messagesOf(schema.safeParse(1e20))).toEqual([NUMBER_OUT_OF_RANGE_MESSAGE])
      expect(messagesOf(schema.safeParse(0.1234567))).toEqual([NUMBER_OUT_OF_RANGE_MESSAGE])
      expect(messagesOf(schema.safeParse(1e-7))).toEqual([NUMBER_OUT_OF_RANGE_MESSAGE])
    },
  )

  it('applies the range check to a number field without precision too', () => {
    const schema = FIELD_TYPE_REGISTRY.number.zodSchema(createTestField({ type: 'number' }))
    expect(messagesOf(schema.safeParse(0.1234567))).toEqual(['Number out of range'])
    expect(schema.safeParse(12500.5).success).toBe(true)
  })
})

describe('emptyValue', () => {
  it('is "" for text and null for every other type (never an invented false)', () => {
    expect(FIELD_TYPE_REGISTRY.text.emptyValue).toBe('')
    for (const type of ['number', 'currency', 'date', 'select', 'checkbox'] as const) {
      expect(FIELD_TYPE_REGISTRY[type].emptyValue).toBeNull()
    }
  })
})

describe('date schema', () => {
  const required = FIELD_TYPE_REGISTRY.date.zodSchema(
    createTestField({ type: 'date', required: true }),
  )
  const optional = FIELD_TYPE_REGISTRY.date.zodSchema(createTestField({ type: 'date' }))

  it('accepts YYYY-MM-DD calendar dates only', () => {
    expect(required.safeParse('2026-11-04').success).toBe(true)
    expect(messagesOf(required.safeParse('2026-02-30'))).toEqual([
      'Enter a valid date (YYYY-MM-DD)',
    ])
    expect(messagesOf(required.safeParse('04/11/2026'))).toEqual([
      'Enter a valid date (YYYY-MM-DD)',
    ])
    expect(messagesOf(required.safeParse(20261104))).toEqual(['Enter a date'])
  })

  it('handles required and optional emptiness', () => {
    expect(messagesOf(required.safeParse(''))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse(null))).toEqual([REQUIRED_MESSAGE])
    expect(optional.safeParse(null).success).toBe(true)
  })
})

describe('select schema', () => {
  const field = createTestField({
    type: 'select',
    required: true,
    options: [
      { value: 'lead', label: 'Lead' },
      { value: 'active', label: 'Active' },
    ],
  })

  it('accepts a current option value and rejects anything else', () => {
    const schema = FIELD_TYPE_REGISTRY.select.zodSchema(field)
    expect(schema.safeParse('lead').success).toBe(true)
    expect(messagesOf(schema.safeParse('Lead'))).toEqual(['Choose one of the current options'])
    expect(messagesOf(schema.safeParse('gone'))).toEqual(['Choose one of the current options'])
    expect(messagesOf(schema.safeParse(''))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(schema.safeParse(null))).toEqual([REQUIRED_MESSAGE])
  })

  it('allows null when optional and still rejects unknown values', () => {
    const schema = FIELD_TYPE_REGISTRY.select.zodSchema({ ...field, required: false })
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse('gone').success).toBe(false)
  })
})

describe('checkbox schema', () => {
  it('accepts booleans, including false when required', () => {
    const required = FIELD_TYPE_REGISTRY.checkbox.zodSchema(
      createTestField({ type: 'checkbox', required: true }),
    )
    expect(required.safeParse(true).success).toBe(true)
    expect(required.safeParse(false).success).toBe(true)
    expect(messagesOf(required.safeParse(null))).toEqual([REQUIRED_MESSAGE])
    expect(messagesOf(required.safeParse('yes'))).toEqual(['Tick or untick the box'])
    const optional = FIELD_TYPE_REGISTRY.checkbox.zodSchema(createTestField({ type: 'checkbox' }))
    expect(optional.safeParse(null).success).toBe(true)
  })
})

describe('formatValue', () => {
  it('renders empty for missing values of every type', () => {
    for (const type of FIELD_TYPES) {
      const field = createTestField({ type })
      expect(formatFieldValue(null, field)).toBe('')
      expect(formatFieldValue(undefined, field)).toBe('')
    }
  })

  it('formats text as is and checkboxes as Yes/No', () => {
    expect(formatFieldValue('Acme Ltd', createTestField())).toBe('Acme Ltd')
    const checkbox = createTestField({ type: 'checkbox' })
    expect(formatFieldValue(true, checkbox)).toBe('Yes')
    expect(formatFieldValue(false, checkbox)).toBe('No')
  })

  it('formats numbers with the configured precision', () => {
    const plain = createTestField({ type: 'number' })
    expect(formatFieldValue(1234.5, plain)).toBe(
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(1234.5),
    )
    const fixed = createTestField({ type: 'number', settings: { precision: 2 } })
    expect(formatFieldValue(1234.5, fixed)).toBe(
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(1234.5),
    )
    expect(formatFieldValue('12', plain)).toBe('')
  })

  it('formats currency with Intl using the field settings and falls back without a code', () => {
    const eur = createTestField({ type: 'currency', settings: { currency: 'EUR', precision: 2 } })
    const formatted = formatFieldValue(1234.5, eur)
    expect(formatted).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(1234.5),
    )
    expect(formatted).toMatch(/€|EUR/)
    const bare = createTestField({ type: 'currency', settings: {} })
    expect(formatFieldValue(0, bare)).toBe(
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(0),
    )
    const bogus = createTestField({ type: 'currency', settings: { currency: 'XXX' } })
    expect(formatFieldValue(1, bogus)).not.toBe('')
  })

  it('formats dates as calendar dates and ignores invalid ones', () => {
    const date = createTestField({ type: 'date' })
    const formatted = formatFieldValue('2026-11-04', date)
    expect(formatted).toContain('2026')
    expect(formatted).not.toBe('2026-11-04')
    expect(formatted).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 10, 4)),
    )
    expect(formatFieldValue('not a date', date)).toBe('')
  })

  it('shows the option label for select values and marks removed options', () => {
    const select = createTestField({
      type: 'select',
      options: [{ value: 'lead', label: 'Lead' }],
    })
    expect(formatFieldValue('lead', select)).toBe('Lead')
    expect(formatFieldValue('gone', select)).toBe('gone (removed option)')
    expect(formatFieldValue('', select)).toBe('')
  })
})
