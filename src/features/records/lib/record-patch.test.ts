import { describe, expect, it } from 'vitest'

import { createClientsFields, createTestField } from '@/test/fields'

import { buildRecordFormSchema, recordToFormValues, type RecordFormValues } from '../schemas/record'
import { isRecordConflict, rebaseFormValues } from './record-conflict'
import {
  GENERIC_RECORD_ERROR_MESSAGE,
  RECORD_NOT_FOUND_MESSAGE,
  getRecordErrorMessage,
  mapRecordSaveError,
} from './record-errors'
import { buildRecordPatch, isEmptyPatch } from './record-values'

const fields = [
  ...createClientsFields(),
  createTestField({ key: 'vip', label: 'VIP', type: 'checkbox', position: 4 }),
]

const stored = {
  title: 'Acme',
  status: 'active',
  custom_values: { company: 'Acme', status: 'lead', value: 1200 },
}

/** What the form submits: the Zod output of the edited values. */
function submitted(values: RecordFormValues): RecordFormValues {
  return buildRecordFormSchema(fields).parse(values) as RecordFormValues
}

describe('buildRecordPatch', () => {
  it('title-only edit of a record whose checkbox was never set sends only the title', () => {
    const snapshot = recordToFormValues(stored, fields)
    expect(snapshot.custom_values.vip).toBeNull()
    const patch = buildRecordPatch(snapshot, submitted({ ...snapshot, title: 'Acme Ltd' }))
    expect(patch).toEqual({ title: 'Acme Ltd' })
  })

  it('sends a checkbox only once the user changes it (false is a value)', () => {
    const snapshot = recordToFormValues(stored, fields)
    const next = submitted({
      ...snapshot,
      custom_values: { ...snapshot.custom_values, vip: false },
    })
    expect(buildRecordPatch(snapshot, next)).toEqual({ set: { vip: false } })
  })

  it('sends changed custom keys in set and cleared keys in unset', () => {
    const snapshot = recordToFormValues(stored, fields)
    const next = submitted({
      ...snapshot,
      custom_values: {
        ...snapshot.custom_values,
        value: 1500,
        status: null,
        contact_email: 'a@b.c',
      },
    })
    expect(buildRecordPatch(snapshot, next)).toEqual({
      set: { contact_email: 'a@b.c', value: 1500 },
      unset: ['status'],
    })
  })

  it('clears the status with null and trims core fields', () => {
    const snapshot = recordToFormValues(stored, fields)
    expect(buildRecordPatch(snapshot, { ...snapshot, status: '  ' })).toEqual({ status: null })
    expect(buildRecordPatch(snapshot, { ...snapshot, title: ' Acme ', status: 'active ' })).toEqual(
      {},
    )
  })

  it('is empty when nothing changed, whatever the key order or empty spelling', () => {
    const snapshot = recordToFormValues(stored, fields)
    const reordered: RecordFormValues = {
      title: 'Acme',
      status: 'active',
      custom_values: {
        vip: undefined,
        value: 1200,
        status: 'lead',
        contact_email: null,
        company: 'Acme',
      },
    }
    const patch = buildRecordPatch(snapshot, reordered)
    expect(patch).toEqual({})
    expect(isEmptyPatch(patch)).toBe(true)
  })

  it('a stale record missing a required value still sends only what changed', () => {
    const withRequired = [
      ...fields,
      createTestField({ key: 'region', label: 'Region', required: true, position: 5 }),
    ]
    const snapshot = recordToFormValues(stored, withRequired)
    const next = { ...snapshot, custom_values: { ...snapshot.custom_values, region: 'North' } }
    expect(buildRecordPatch(snapshot, next)).toEqual({ set: { region: 'North' } })
  })
})

describe('rebaseFormValues (PT409 reload)', () => {
  const base = recordToFormValues(stored, fields)

  it('takes the latest version for untouched fields and keeps the user edits', () => {
    const current = {
      ...base,
      title: 'Acme Holdings',
      custom_values: { ...base.custom_values, value: 999 },
    }
    const latest = recordToFormValues(
      {
        title: 'Acme (renamed)',
        status: 'paused',
        custom_values: { company: 'Acme Group', status: 'lead', value: 1300, vip: true },
      },
      fields,
    )
    const { values, kept } = rebaseFormValues(base, current, latest)
    expect(values).toEqual({
      title: 'Acme Holdings',
      status: 'paused',
      custom_values: {
        company: 'Acme Group',
        contact_email: '',
        status: 'lead',
        value: 999,
        vip: true,
      },
    })
    expect(kept).toEqual(['title', 'custom_values.value'])
  })

  it('keeps a value the user cleared and raw input that does not parse yet', () => {
    const current = {
      ...base,
      custom_values: { ...base.custom_values, company: '', value: '12abc' },
    }
    const { values, kept } = rebaseFormValues(base, current, base)
    expect(values.custom_values.company).toBe('')
    expect(values.custom_values.value).toBe('12abc')
    expect(kept).toEqual(['custom_values.company', 'custom_values.value'])
  })
})

describe('update_record errors', () => {
  const pg = (code: string, message: string) => ({ code, message, details: null, hint: null })

  it('recognises the PT409 record_changed conflict', () => {
    expect(isRecordConflict(pg('PT409', 'record_changed'))).toBe(true)
    expect(isRecordConflict(pg('23514', 'custom_values.value: expected number'))).toBe(false)
    expect(isRecordConflict(new Error('record_changed'))).toBe(false)
  })

  it('maps PT404 to record not found and keeps 23514 on the field', () => {
    expect(getRecordErrorMessage(pg('PT404', 'record_not_found'))).toBe(RECORD_NOT_FOUND_MESSAGE)
    expect(
      mapRecordSaveError(pg('23514', 'custom_values.value: number out of range'), ['value']),
    ).toMatchObject({ field: { key: 'value', message: 'Number out of range' } })
    expect(getRecordErrorMessage(pg('XX000', 'boom'))).toBe(GENERIC_RECORD_ERROR_MESSAGE)
  })
})
