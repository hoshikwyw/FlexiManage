import { describe, expect, it } from 'vitest'

import { createClientsFields, createTestField } from '@/test/fields'

import { buildDefaultValues, buildRecordSchema } from './build-record-schema'
import { REQUIRED_MESSAGE } from './registry'

describe('buildRecordSchema', () => {
  const schema = buildRecordSchema(createClientsFields())

  it('accepts values that match the definitions', () => {
    const result = schema.safeParse({
      company: 'Acme Ltd',
      contact_email: 'ops@acme.example',
      status: 'active',
      value: 4200.5,
    })
    expect(result.success).toBe(true)
  })

  it('reports a missing required field under its key', () => {
    const result = schema.safeParse({ company: '', status: 'lead' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['company'], message: REQUIRED_MESSAGE }),
    ])
  })

  it('lets optional fields be absent or null', () => {
    expect(schema.safeParse({ company: 'Acme' }).success).toBe(true)
    expect(schema.safeParse({ company: 'Acme', value: null, status: null }).success).toBe(true)
  })

  it('rejects unknown keys like the server does', () => {
    const result = schema.safeParse({ company: 'Acme', nope: 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys')
  })

  it('routes each value through its type schema', () => {
    const result = schema.safeParse({ company: 'Acme', status: 'gone', value: 'free' })
    expect(result.success).toBe(false)
    const byPath = new Map(result.error?.issues.map((i) => [String(i.path[0]), i.message]))
    expect(byPath.get('status')).toBe('Choose one of the current options')
    expect(byPath.get('value')).toBe('Enter a number')
  })

  it('produces an empty strict object for a module without fields', () => {
    const empty = buildRecordSchema([])
    expect(empty.safeParse({}).success).toBe(true)
    expect(empty.safeParse({ anything: 1 }).success).toBe(false)
  })
})

describe('buildDefaultValues', () => {
  it('uses each type default keyed by field key', () => {
    expect(
      buildDefaultValues([
        createTestField({ key: 'name', type: 'text' }),
        createTestField({ key: 'done', type: 'checkbox' }),
        createTestField({ key: 'due', type: 'date' }),
      ]),
    ).toEqual({ name: '', done: false, due: null })
  })
})
