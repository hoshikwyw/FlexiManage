import { describe, expect, it, vi } from 'vitest'

import { createClientsFields } from '@/test/fields'

import { changedPositions, moveField } from './use-reorder-fields'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

describe('moveField', () => {
  it('moves a field and renumbers positions 0..n-1', () => {
    const fields = createClientsFields()
    const moved = moveField(fields, 3, 0)
    expect(moved.map((f) => f.key)).toEqual(['value', 'company', 'contact_email', 'status'])
    expect(moved.map((f) => f.position)).toEqual([0, 1, 2, 3])
    expect(fields.map((f) => f.key)).toEqual(['company', 'contact_email', 'status', 'value'])
  })

  it('moves down and clamps out-of-range targets', () => {
    const fields = createClientsFields()
    expect(moveField(fields, 0, 1).map((f) => f.key)).toEqual([
      'contact_email',
      'company',
      'status',
      'value',
    ])
    expect(moveField(fields, 0, 99).map((f) => f.key)).toEqual([
      'contact_email',
      'status',
      'value',
      'company',
    ])
    expect(moveField(fields, 9, 0).map((f) => f.key)).toEqual(fields.map((f) => f.key))
  })
})

describe('changedPositions', () => {
  it('lists only the fields whose position differs from the previous list', () => {
    const previous = createClientsFields()
    const ordered = moveField(previous, 3, 2)
    expect(changedPositions(previous, ordered).map((f) => [f.key, f.position])).toEqual([
      ['value', 2],
      ['status', 3],
    ])
    expect(changedPositions(previous, previous)).toEqual([])
  })

  it('treats fields missing from the previous list as changed', () => {
    const previous = createClientsFields().slice(0, 2)
    const ordered = createClientsFields()
    expect(changedPositions(previous, ordered).map((f) => f.key)).toEqual(['status', 'value'])
  })
})
