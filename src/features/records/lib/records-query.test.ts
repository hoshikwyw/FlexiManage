import { describe, expect, it } from 'vitest'

import { createClientsFields, createTestField } from '@/test/fields'

import type { RecordsQuery } from '../types'
import {
  DEFAULT_RECORDS_QUERY,
  hasActiveCriteria,
  nextSort,
  parseRecordsQuery,
  serialiseRecordsQuery,
  withFilter,
  withoutCriteria,
} from './records-query'

const fields = [
  ...createClientsFields(),
  createTestField({ key: 'due', label: 'Due', type: 'date', position: 4 }),
  createTestField({ key: 'done', label: 'Done', type: 'checkbox', position: 5 }),
  createTestField({ key: 'rooms', label: 'Rooms', type: 'number', position: 6 }),
]

function parse(search: string) {
  return parseRecordsQuery(new URLSearchParams(search), fields)
}

describe('parseRecordsQuery', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parse('')).toEqual(DEFAULT_RECORDS_QUERY)
    expect(DEFAULT_RECORDS_QUERY).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: { by: 'updated_at', dir: 'desc' },
    })
  })

  it('reads search, page, size and sort', () => {
    expect(parse('q=%20acme%20&page=3&size=50&sort=title&dir=asc')).toEqual({
      ...DEFAULT_RECORDS_QUERY,
      search: 'acme',
      page: 3,
      pageSize: 50,
      sort: { by: 'title', dir: 'asc' },
    })
  })

  it('falls back to defaults for invalid page, size, sort and dir', () => {
    expect(parse('page=0&size=30&sort=nope&dir=up')).toEqual(DEFAULT_RECORDS_QUERY)
    expect(parse('page=-2').page).toBe(1)
    expect(parse('page=abc').page).toBe(1)
    expect(parse('page=1.5').page).toBe(1)
    expect(parse('size=1000').pageSize).toBe(25)
    expect(parse('sort=title&dir=sideways').sort).toEqual({ by: 'title', dir: 'asc' })
  })

  it('accepts f.<key> sorts for known fields only, kept apart from the core status column', () => {
    expect(parse('sort=f.status&dir=desc').sort).toEqual({ by: 'f.status', dir: 'desc' })
    expect(parse('sort=status&dir=desc').sort).toEqual({ by: 'status', dir: 'desc' })
    expect(parse('sort=f.unknown&dir=asc').sort).toEqual(DEFAULT_RECORDS_QUERY.sort)
  })

  it('parses one filter per field kind in field order', () => {
    const query = parse(
      'f.rooms=2..&f.company=%20acme%20&f.status=lead&f.status=active&f.done=true&f.value=100..500.5&f.due=..2026-12-31',
    )
    expect(query.filters).toEqual([
      { kind: 'text', key: 'company', value: 'acme' },
      { kind: 'options', key: 'status', values: ['lead', 'active'] },
      { kind: 'number-range', key: 'value', min: 100, max: 500.5 },
      { kind: 'date-range', key: 'due', min: null, max: '2026-12-31' },
      { kind: 'boolean', key: 'done', value: true },
      { kind: 'number-range', key: 'rooms', min: 2, max: null },
    ])
  })

  it('drops unknown field keys and invalid filter values', () => {
    const query = parse(
      'f.nope=1&f.company=%20%20&f.status=gone&f.done=yes&f.value=abc..&f.due=2026-02-30..&f.rooms=..',
    )
    expect(query.filters).toEqual([])
  })

  it('keeps only current option values and removes duplicates', () => {
    expect(parse('f.status=lead&f.status=gone&f.status=lead').filters).toEqual([
      { kind: 'options', key: 'status', values: ['lead'] },
    ])
  })

  it('caps the search term at 200 characters', () => {
    expect(parse(`q=${'a'.repeat(300)}`).search).toHaveLength(200)
  })
})

describe('serialiseRecordsQuery', () => {
  it('omits every default', () => {
    expect(serialiseRecordsQuery(DEFAULT_RECORDS_QUERY).toString()).toBe('')
  })

  it('writes non-defaults and round-trips through parse', () => {
    const query: RecordsQuery = {
      page: 2,
      pageSize: 100,
      sort: { by: 'f.value', dir: 'asc' },
      search: 'acme ltd',
      filters: [
        { kind: 'text', key: 'company', value: 'a,b & c' },
        { kind: 'options', key: 'status', values: ['lead', 'churned'] },
        { kind: 'number-range', key: 'value', min: -5, max: null },
        { kind: 'date-range', key: 'due', min: '2026-01-01', max: '2026-12-31' },
        { kind: 'boolean', key: 'done', value: false },
      ],
    }
    const params = serialiseRecordsQuery(query)
    expect(params.get('q')).toBe('acme ltd')
    expect(params.getAll('f.status')).toEqual(['lead', 'churned'])
    expect(params.get('f.value')).toBe('-5..')
    expect(params.get('f.due')).toBe('2026-01-01..2026-12-31')
    expect(params.get('sort')).toBe('f.value')
    expect(params.get('page')).toBe('2')
    expect(params.get('size')).toBe('100')
    const back = parseRecordsQuery(new URLSearchParams(params.toString()), fields)
    // The filters above are already in field order, which is the order parse returns.
    expect(back).toEqual(query)
  })

  it('keeps unrelated parameters such as tab and replaces stale records parameters', () => {
    const base = new URLSearchParams('tab=fields&q=old&f.status=lead&page=4')
    const params = serialiseRecordsQuery({ ...DEFAULT_RECORDS_QUERY, search: 'new' }, base)
    expect(params.toString()).toBe('tab=fields&q=new')
  })
})

describe('query helpers', () => {
  it('withFilter replaces the filter on a key and resets to page 1', () => {
    const start: RecordsQuery = {
      ...DEFAULT_RECORDS_QUERY,
      page: 3,
      filters: [{ kind: 'text', key: 'company', value: 'a' }],
    }
    const next = withFilter(start, 'company', { kind: 'text', key: 'company', value: 'b' })
    expect(next.page).toBe(1)
    expect(next.filters).toEqual([{ kind: 'text', key: 'company', value: 'b' }])
    expect(withFilter(next, 'company', null).filters).toEqual([])
  })

  it('withoutCriteria clears search and filters but keeps sort and size', () => {
    const query: RecordsQuery = {
      page: 2,
      pageSize: 50,
      sort: { by: 'title', dir: 'asc' },
      search: 'x',
      filters: [{ kind: 'boolean', key: 'done', value: true }],
    }
    expect(hasActiveCriteria(query)).toBe(true)
    const cleared = withoutCriteria(query)
    expect(cleared).toEqual({ ...query, page: 1, search: '', filters: [] })
    expect(hasActiveCriteria(cleared)).toBe(false)
  })

  it('nextSort flips the same column and starts new columns ascending (dates newest first)', () => {
    expect(nextSort({ by: 'title', dir: 'asc' }, 'title')).toEqual({ by: 'title', dir: 'desc' })
    expect(nextSort({ by: 'title', dir: 'desc' }, 'title')).toEqual({ by: 'title', dir: 'asc' })
    expect(nextSort({ by: 'title', dir: 'desc' }, 'f.value')).toEqual({ by: 'f.value', dir: 'asc' })
    expect(nextSort({ by: 'title', dir: 'asc' }, 'updated_at')).toEqual({
      by: 'updated_at',
      dir: 'desc',
    })
  })
})
