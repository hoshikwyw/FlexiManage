import { describe, expect, it } from 'vitest'

import { emptyFieldForm } from '../lib/field-payload'
import { fieldFormSchema, fieldKeySchema, selectOptionsSchema } from './field'

describe('fieldKeySchema', () => {
  it('accepts lowercase keys starting with a letter, up to 50 characters', () => {
    expect(fieldKeySchema.safeParse('due_date').success).toBe(true)
    expect(fieldKeySchema.safeParse('a').success).toBe(true)
    expect(fieldKeySchema.safeParse(`a${'b'.repeat(49)}`).success).toBe(true)
  })

  it('rejects uppercase, leading digits, hyphens, spaces and overlong keys', () => {
    for (const bad of ['Due', '2nd', 'due-date', 'due date', '', `a${'b'.repeat(50)}`]) {
      expect(fieldKeySchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('selectOptionsSchema', () => {
  it('needs at least one option with non-empty value and label', () => {
    expect(selectOptionsSchema.safeParse([]).error?.issues[0]?.message).toBe(
      'Add at least one option',
    )
    expect(selectOptionsSchema.safeParse([{ value: '', label: 'Lead' }]).success).toBe(false)
    expect(selectOptionsSchema.safeParse([{ value: 'lead', label: 'Lead' }]).success).toBe(true)
  })

  it('reports duplicate values on the later option', () => {
    const result = selectOptionsSchema.safeParse([
      { value: 'lead', label: 'Lead' },
      { value: 'lead', label: 'Lead again' },
    ])
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: [1, 'value'],
        message: 'Duplicate of option 1; option values must be distinct',
      }),
    ])
  })
})

describe('fieldFormSchema', () => {
  it('accepts a plain text field and ignores options for non-select types', () => {
    const result = fieldFormSchema.safeParse({
      ...emptyFieldForm('text'),
      label: 'Vendor',
      key: 'vendor',
      options: [{ value: 'x', label: 'x' }],
    })
    expect(result.success).toBe(true)
  })

  it('requires options for select fields and nests their issues under options', () => {
    const empty = fieldFormSchema.safeParse({
      ...emptyFieldForm('select'),
      label: 'Status',
      key: 'status',
    })
    expect(empty.error?.issues).toEqual([
      expect.objectContaining({ path: ['options'], message: 'Add at least one option' }),
    ])
    const duplicate = fieldFormSchema.safeParse({
      ...emptyFieldForm('select'),
      label: 'Status',
      key: 'status',
      options: [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'A2' },
      ],
    })
    expect(duplicate.error?.issues[0]?.path).toEqual(['options', 1, 'value'])
  })

  it('requires a currency code for currency fields and bounds precision to 0..6', () => {
    const noCode = fieldFormSchema.safeParse({
      ...emptyFieldForm('currency'),
      label: 'Price',
      key: 'price',
      settings: { currency: '', precision: 2 },
    })
    expect(noCode.error?.issues).toEqual([
      expect.objectContaining({ path: ['settings', 'currency'], message: 'Choose a currency' }),
    ])
    const tooPrecise = fieldFormSchema.safeParse({
      ...emptyFieldForm('number'),
      label: 'Qty',
      key: 'qty',
      settings: { currency: '', precision: 7 },
    })
    expect(tooPrecise.error?.issues[0]?.path).toEqual(['settings', 'precision'])
    const ok = fieldFormSchema.safeParse({
      ...emptyFieldForm('currency'),
      label: 'Price',
      key: 'price',
      settings: { currency: 'EUR', precision: 2 },
    })
    expect(ok.success).toBe(true)
  })

  it('requires label and key', () => {
    const result = fieldFormSchema.safeParse(emptyFieldForm('text'))
    const messages = result.error?.issues.map((issue) => issue.message)
    expect(messages).toContain('Label is required')
    expect(messages).toContain('Key is required')
  })
})
