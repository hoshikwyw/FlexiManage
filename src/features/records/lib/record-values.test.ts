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
import { compactCustomValues } from './record-values'

describe('record values', () => {
  it('compactCustomValues drops null, undefined and empty strings but keeps false and 0', () => {
    expect(compactCustomValues({ a: null, b: undefined, c: '', d: false, e: 0, f: 'x' })).toEqual({
      d: false,
      e: 0,
      f: 'x',
    })
  })

  it('recordToFormValues keeps a never-set checkbox unset instead of false', () => {
    const fields = [
      createTestField({ key: 'company', label: 'Company' }),
      createTestField({ key: 'vip', label: 'VIP', type: 'checkbox', position: 1 }),
    ]
    expect(
      recordToFormValues(
        { title: 'Acme', status: null, custom_values: { company: 'Acme' } },
        fields,
      ).custom_values,
    ).toEqual({ company: 'Acme', vip: null })
    expect(
      recordToFormValues({ title: 'A', status: null, custom_values: { vip: false } }, fields)
        .custom_values,
    ).toEqual({ company: '', vip: false })
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

  it('rejects a whitespace-only title and required text client-side', () => {
    const schema = buildRecordFormSchema(createClientsFields())
    const result = schema.safeParse({
      title: '   ',
      status: '',
      custom_values: { company: ' \t ', contact_email: '', status: null, value: null },
    })
    expect(result.success).toBe(false)
    const issues = result.success ? [] : result.error.issues
    expect(issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['title', 'Enter a title'],
      ['custom_values.company', 'This field is required'],
    ])
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
