import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { createQueryBuilderMock } from '@/test/query-builder-mock'

import { DEFAULT_RECORDS_QUERY } from '../lib/records-query'
import { fetchRecord, fetchRecordCounts, fetchRecords } from './record-queries'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const from = vi.mocked(supabase.from)

describe('record queries', () => {
  beforeEach(() => from.mockReset())

  it('scopes the list by workspace and module, counts exactly and pages with range()', async () => {
    const builder = createQueryBuilderMock({ data: [], count: 60, error: null })
    from.mockReturnValue(builder as never)

    const page = await fetchRecords(TEST_WORKSPACE_ID, TEST_MODULE_ID, {
      ...DEFAULT_RECORDS_QUERY,
      page: 3,
      pageSize: 25,
      search: 'acme',
    })

    expect(from).toHaveBeenCalledWith('records')
    expect(builder.callsOf('select')[0]?.[1]).toEqual({ count: 'exact' })
    expect(builder.callsOf('eq')).toEqual([
      ['workspace_id', TEST_WORKSPACE_ID],
      ['module_id', TEST_MODULE_ID],
    ])
    expect(builder.callsOf('textSearch')).toEqual([
      ['search_vector', 'acme:*', { config: 'simple' }],
    ])
    expect(builder.callsOf('order')[0]).toEqual([
      'updated_at',
      { ascending: false, nullsFirst: false },
    ])
    expect(builder.callsOf('range')).toEqual([[50, 74]])
    expect(page).toEqual({ rows: [], total: 60 })
  })

  it('answers an out-of-range page (PGRST103) with a head count', async () => {
    const pageQuery = createQueryBuilderMock({
      data: null,
      count: null,
      error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
    })
    const countQuery = createQueryBuilderMock({ data: null, count: 33, error: null })
    from.mockReturnValueOnce(pageQuery as never).mockReturnValueOnce(countQuery as never)

    const page = await fetchRecords(TEST_WORKSPACE_ID, TEST_MODULE_ID, {
      ...DEFAULT_RECORDS_QUERY,
      page: 9,
    })
    expect(page).toEqual({ rows: [], total: 33, outOfRange: true })
    expect(countQuery.callsOf('select')[0]).toEqual(['id', { count: 'exact', head: true }])
  })

  it('returns null for a record id that is not a uuid without querying', async () => {
    expect(await fetchRecord(TEST_WORKSPACE_ID, TEST_MODULE_ID, 'not-a-uuid')).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('counts records per module with parallel head-only queries', async () => {
    from
      .mockReturnValueOnce(createQueryBuilderMock({ count: 3, error: null }) as never)
      .mockReturnValueOnce(createQueryBuilderMock({ count: 0, error: null }) as never)
    expect(await fetchRecordCounts(TEST_WORKSPACE_ID, ['m1', 'm2'])).toEqual({ m1: 3, m2: 0 })
  })
})
