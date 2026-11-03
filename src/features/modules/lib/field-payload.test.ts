import { describe, expect, it } from 'vitest'

import { createTestField } from '@/test/fields'

import { emptyFieldForm, fieldToForm, toFieldPayload } from './field-payload'

describe('toFieldPayload', () => {
  it('sends empty options and settings for a text field even if the form holds leftovers', () => {
    expect(
      toFieldPayload({
        ...emptyFieldForm('text'),
        label: 'Vendor',
        key: 'vendor',
        options: [{ value: 'x', label: 'X' }],
        settings: { currency: 'EUR', precision: 2 },
      }),
    ).toEqual({
      label: 'Vendor',
      key: 'vendor',
      type: 'text',
      required: false,
      options: [],
      settings: {},
    })
  })

  it('keeps options for select and only precision for number', () => {
    expect(
      toFieldPayload({
        ...emptyFieldForm('select'),
        label: 'Status',
        key: 'status',
        required: true,
        options: [{ value: 'a', label: 'A' }],
        settings: { currency: 'EUR', precision: 2 },
      }),
    ).toMatchObject({ options: [{ value: 'a', label: 'A' }], settings: {}, required: true })
    expect(
      toFieldPayload({
        ...emptyFieldForm('number'),
        label: 'Qty',
        key: 'qty',
        settings: { currency: 'EUR', precision: 0 },
      }).settings,
    ).toEqual({ precision: 0 })
    expect(
      toFieldPayload({ ...emptyFieldForm('number'), label: 'Qty', key: 'qty' }).settings,
    ).toEqual({})
  })

  it('keeps currency and precision for currency fields', () => {
    expect(
      toFieldPayload({
        ...emptyFieldForm('currency'),
        label: 'Price',
        key: 'price',
        settings: { currency: 'USD', precision: 2 },
      }).settings,
    ).toEqual({ currency: 'USD', precision: 2 })
  })
})

describe('fieldToForm', () => {
  it('maps a row back to form values, normalising unknown settings', () => {
    expect(
      fieldToForm(
        createTestField({
          type: 'currency',
          label: 'Contract value',
          key: 'value',
          required: true,
          settings: { currency: 'EUR', precision: 2 },
        }),
      ),
    ).toEqual({
      label: 'Contract value',
      key: 'value',
      type: 'currency',
      required: true,
      options: [],
      settings: { currency: 'EUR', precision: 2 },
    })
    expect(
      fieldToForm(createTestField({ type: 'currency', settings: { currency: 'ZZZ' } })).settings,
    ).toEqual({ currency: '', precision: '' })
  })
})
