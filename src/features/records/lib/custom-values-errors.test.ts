import { describe, expect, it } from 'vitest'

import {
  describeCustomValuesReason,
  parseCustomValuesError,
  parseCustomValuesMessage,
} from './custom-values-errors'

function pgError(code: string, message: string) {
  return { code, message, details: 'column = custom_values', hint: '', name: 'PostgrestError' }
}

describe('parseCustomValuesMessage', () => {
  it('extracts the field key and reason', () => {
    expect(parseCustomValuesMessage('custom_values.due_date: required')).toEqual({
      key: 'due_date',
      reason: 'required',
    })
    expect(parseCustomValuesMessage('custom_values.value: expected number')).toEqual({
      key: 'value',
      reason: 'expected number',
    })
    expect(
      parseCustomValuesMessage('custom_values.notes: text longer than 2000 characters'),
    ).toEqual({ key: 'notes', reason: 'text longer than 2000 characters' })
  })

  it('returns no key for object-level messages', () => {
    expect(parseCustomValuesMessage('custom_values: expected object')).toEqual({
      reason: 'expected object',
    })
  })

  it('ignores unrelated messages', () => {
    expect(parseCustomValuesMessage('field_definitions.key: cannot be changed')).toBeNull()
    expect(parseCustomValuesMessage('new row violates check constraint')).toBeNull()
    expect(parseCustomValuesMessage('custom_values.Bad-Key: required')).toBeNull()
  })
})

describe('parseCustomValuesError', () => {
  it('only accepts 23514 PostgREST errors with the expected message', () => {
    expect(
      parseCustomValuesError(pgError('23514', 'custom_values.status: not one of the options')),
    ).toEqual({ key: 'status', reason: 'not one of the options' })
    expect(parseCustomValuesError(pgError('23505', 'custom_values.status: required'))).toBeNull()
    expect(parseCustomValuesError(pgError('23514', 'something else'))).toBeNull()
    expect(parseCustomValuesError(new Error('custom_values.status: required'))).toBeNull()
    expect(parseCustomValuesError(undefined)).toBeNull()
  })
})

describe('describeCustomValuesReason', () => {
  it('maps the documented reasons to form copy', () => {
    expect(describeCustomValuesReason('required')).toBe('This field is required')
    expect(describeCustomValuesReason('expected number')).toBe('Enter a number')
    expect(describeCustomValuesReason('expected date YYYY-MM-DD')).toBe(
      'Enter a valid date (YYYY-MM-DD)',
    )
    expect(describeCustomValuesReason('not one of the options')).toBe(
      'Choose one of the current options',
    )
    expect(describeCustomValuesReason('text longer than 2000 characters')).toBe(
      'Use at most 2,000 characters',
    )
    expect(describeCustomValuesReason('number out of range')).toBe('Number out of range')
    expect(describeCustomValuesReason('something new')).toBe('something new')
  })
})
