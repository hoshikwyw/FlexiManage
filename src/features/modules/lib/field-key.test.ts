import { describe, expect, it } from 'vitest'

import {
  FIELD_KEY_MAX_LENGTH,
  deriveFieldKey,
  deriveOptionValue,
  isValidFieldKey,
} from './field-key'

describe('deriveFieldKey', () => {
  it('lowercases and joins words with underscores', () => {
    expect(deriveFieldKey('Due date')).toBe('due_date')
    expect(deriveFieldKey('  Guests   arriving ')).toBe('guests_arriving')
    expect(deriveFieldKey('Contact e-mail')).toBe('contact_e_mail')
  })

  it('strips diacritics and characters outside a-z0-9', () => {
    expect(deriveFieldKey('Café Ümlaut')).toBe('cafe_umlaut')
    expect(deriveFieldKey('Price (EUR)!')).toBe('price_eur')
    expect(deriveFieldKey('日本語')).toBe('')
  })

  it('prefixes keys that would start with a digit', () => {
    expect(deriveFieldKey('2nd floor')).toBe('f_2nd_floor')
    expect(deriveFieldKey('42')).toBe('f_42')
  })

  it('cuts to 50 characters without a trailing underscore and always yields a valid key', () => {
    const long = `${'a'.repeat(49)} ${'b'.repeat(20)}`
    const key = deriveFieldKey(long)
    expect(key.length).toBeLessThanOrEqual(FIELD_KEY_MAX_LENGTH)
    expect(key.endsWith('_')).toBe(false)
    expect(isValidFieldKey(key)).toBe(true)
    for (const label of ['Room', 'Task type', 'Inspected?', '1 2 3']) {
      expect(isValidFieldKey(deriveFieldKey(label))).toBe(true)
    }
  })

  it('derives option values the same way', () => {
    expect(deriveOptionValue('Checkout clean')).toBe('checkout_clean')
    expect(deriveOptionValue('In progress')).toBe('in_progress')
  })
})
