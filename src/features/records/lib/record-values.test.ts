import { describe, expect, it } from 'vitest'

import { createClientsFields, createTestField } from '@/test/fields'

import {
  buildRecordFormSchema,
  missingRequiredFields,
  recordToFormValues,
  toRecordPayload,
} from '../schemas/record'
import {
  RECORD_FIELDS_CHANGED_MESSAGE,
  RECORD_FIELD_ERROR_MESSAGE,
  RECORD_FORBIDDEN_MESSAGE,
  RecordNotFoundError,
  getRecordErrorMessage,
  mapRecordSaveError,
} from './record-errors'
import { compactCustomValues, diffRecordPayload } from './record-values'

describe('record values', () => {
  it('compactCustomValues drops null, undefined and empty strings but keeps false and 0', () => {
    expect(compactCustomValues({ a: null, b: undefined, c: '', d: false, e: 0, f: 'x' })).toEqual({
      d: false,
      e: 0,
      f: 'x',
    })
  })

  it('diffRecordPayload sends only changed columns and ignores key order and empty values', () => {
    const current = {
      title: 'Acme',
      status: null,
      custom_values: { value: 1, company: 'Acme', contact_email: null },
    }
    expect(
      diffRecordPayload(current, {
        title: 'Acme',
        status: null,
        custom_values: { company: 'Acme', value: 1 },
      }),
    ).toEqual({})
    expect(
      diffRecordPayload(current, {
        title: 'Acme 2',
        status: 'vip',
        custom_values: { company: 'Acme', value: 2 },
      }),
    ).toEqual({ title: 'Acme 2', status: 'vip', custom_values: { company: 'Acme', value: 2 } })
  })

  it('recordToFormValues fills defaults, drops keys without a field and maps null status to ""', () => {
    const values = recordToFormValues(
      { title: 'Acme', status: null, custom_values: { company: 'Acme', gone: 1 } },
      createClientsFields(),
    )
    expect(values).toEqual({
      title: 'Acme',
      status: '',
      custom_values: { company: 'Acme', contact_email: '', status: null, value: null },
    })
    expect(buildRecordFormSchema(createClientsFields()).safeParse(values).success).toBe(true)
  })

  it('toRecordPayload trims and turns an empty status into null', () => {
    expect(
      toRecordPayload({
        title: ' Acme ',
        status: '  ',
        custom_values: { company: 'Acme', value: null },
      }),
    ).toEqual({ title: 'Acme', status: null, custom_values: { company: 'Acme' } })
  })

  it('missingRequiredFields lists required fields without a stored value (stale records)', () => {
    const fields = [
      ...createClientsFields(),
      createTestField({ key: 'region', label: 'Region', required: true, position: 4 }),
      createTestField({ key: 'ok', label: 'OK', type: 'checkbox', required: true, position: 5 }),
    ]
    const missing = missingRequiredFields({ custom_values: { company: 'Acme', ok: false } }, fields)
    expect(missing.map((field) => field.key)).toEqual(['region'])
  })
})

describe('record errors', () => {
  const check = (message: string) => ({ code: '23514', message, details: null, hint: null })

  it('maps a 23514 custom_values message onto the named field', () => {
    expect(mapRecordSaveError(check('custom_values.value: expected number'), ['value'])).toEqual({
      field: { key: 'value', message: 'Enter a number' },
      formError: RECORD_FIELD_ERROR_MESSAGE,
    })
  })

  it('flags a field the form does not know (definitions changed meanwhile)', () => {
    expect(mapRecordSaveError(check('custom_values.region: required'), ['company'])).toEqual({
      field: { key: 'region', message: 'This field is required' },
      formError: RECORD_FIELDS_CHANGED_MESSAGE,
    })
  })

  it('uses form-level copy for 42501, zero rows and other checks', () => {
    expect(mapRecordSaveError({ code: '42501', message: 'denied' }, [])).toEqual({
      formError: RECORD_FORBIDDEN_MESSAGE,
    })
    expect(getRecordErrorMessage({ code: 'PGRST116', message: '0 rows' })).toMatch(
      /no longer exists/,
    )
    expect(getRecordErrorMessage(new RecordNotFoundError())).toMatch(/no longer exists/)
    expect(
      getRecordErrorMessage(check('new row violates check constraint "records_title_check"')),
    ).toMatch(/title of 1 to 200/)
  })
})
