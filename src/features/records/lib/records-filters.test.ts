import { describe, expect, it } from 'vitest'

import { createQueryBuilderMock, type QueryBuilderMock } from '@/test/query-builder-mock'

import type { RecordsQueryBuilder } from './records-filters'
import {
  applyFilter,
  applyRecordsQuery,
  applySearch,
  applySort,
  buildPrefixTsQuery,
  escapeLike,
  tokenizeSearch,
} from './records-filters'

type Builder = QueryBuilderMock & RecordsQueryBuilder<Builder>

function builder(): Builder {
  return createQueryBuilderMock({ data: [], error: null }) as Builder
}

describe('buildPrefixTsQuery', () => {
  it('turns each word into a prefix term joined with &', () => {
    expect(buildPrefixTsQuery('glob')).toBe('glob:*')
    expect(buildPrefixTsQuery('  Acme   Ltd ')).toBe('acme:* & ltd:*')
  })

  it('drops quotes, colons, ampersands and other tsquery syntax', () => {
    expect(buildPrefixTsQuery("O'Brien")).toBe('o:* & brien:*')
    expect(buildPrefixTsQuery('"acme"')).toBe('acme:*')
    expect(buildPrefixTsQuery('acme:* & !ltd | (x)')).toBe('acme:* & ltd:* & x:*')
    expect(buildPrefixTsQuery('a:b')).toBe('a:* & b:*')
  })

  it('keeps unicode letters and digits and removes duplicates', () => {
    expect(buildPrefixTsQuery('Café Müller 42')).toBe('café:* & müller:* & 42:*')
    expect(buildPrefixTsQuery('東京 株式会社')).toBe('東京:* & 株式会社:*')
    expect(buildPrefixTsQuery('acme ACME')).toBe('acme:*')
  })

  // The contract cases shared with the export-records tokenizer.
  it.each([
    ['12500.5', '12500.5:*'],
    ['jane@acme.example', 'jane@acme.example:*'],
    ['example.com', 'example.com:*'],
    ['-5', '5:*'],
    ['café', 'café:*'],
    ['a.b.', 'a.b:*'],
    ['...', null],
    ['"quoted"', 'quoted:*'],
    ['ACME acme', 'acme:*'],
  ])('tokenizes %j as %j', (input, expected) => {
    expect(buildPrefixTsQuery(input)).toBe(expected)
  })

  it('keeps . @ - _ + inside tokens and strips them at the edges', () => {
    expect(tokenizeSearch('ops@acme.example, +44-20 _x_ snake_case')).toEqual([
      'ops@acme.example',
      '44-20',
      'x',
      'snake_case',
    ])
    expect(tokenizeSearch('--- @@ ++ __')).toEqual([])
    expect(tokenizeSearch('a+b (c*d)')).toEqual(['a+b', 'c', 'd'])
  })

  it('NFC-normalises so composed and decomposed accents give the same token', () => {
    expect(tokenizeSearch('café café')).toEqual(['café'])
  })

  it('returns null for empty input or input without word characters', () => {
    expect(buildPrefixTsQuery('')).toBeNull()
    expect(buildPrefixTsQuery('   ')).toBeNull()
    expect(buildPrefixTsQuery('&&: !|')).toBeNull()
  })

  it('caps the number of words', () => {
    expect(buildPrefixTsQuery('a b c d e f g h i j')?.split(' & ')).toHaveLength(8)
  })
})

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(escapeLike('plain')).toBe('plain')
  })
})

describe('applySearch', () => {
  it('uses full-text search with the simple config for words', () => {
    const b = applySearch(builder(), 'acme ltd')
    expect(b.calls).toEqual([
      ['textSearch', 'search_vector', 'acme:* & ltd:*', { config: 'simple' }],
    ])
  })

  it('falls back to an escaped title ilike without word characters', () => {
    const b = applySearch(builder(), ' %_ ')
    expect(b.calls).toEqual([['ilike', 'title', '%\\%\\_%']])
    expect(applySearch(builder(), '...').calls).toEqual([['ilike', 'title', '%...%']])
  })

  it('searches an email as one prefix token', () => {
    expect(applySearch(builder(), 'jane@acme.example').calls).toEqual([
      ['textSearch', 'search_vector', 'jane@acme.example:*', { config: 'simple' }],
    ])
  })

  it('does nothing for an empty term', () => {
    expect(applySearch(builder(), '  ').calls).toEqual([])
  })
})

describe('applyFilter', () => {
  it('text: case-insensitive contains on custom_values->>key, escaped', () => {
    const b = applyFilter(builder(), { kind: 'text', key: 'company', value: '10%' })
    expect(b.calls).toEqual([['ilike', 'custom_values->>company', '%10\\%%']])
  })

  it('select: one option uses jsonb containment, several use in()', () => {
    expect(
      applyFilter(builder(), { kind: 'options', key: 'status', values: ['lead'] }).calls,
    ).toEqual([['contains', 'custom_values', { status: 'lead' }]])
    expect(
      applyFilter(builder(), { kind: 'options', key: 'status', values: ['lead', 'active'] }).calls,
    ).toEqual([['in', 'custom_values->>status', ['lead', 'active']]])
  })

  it('checkbox: containment with the boolean', () => {
    expect(applyFilter(builder(), { kind: 'boolean', key: 'done', value: false }).calls).toEqual([
      ['contains', 'custom_values', { done: false }],
    ])
  })

  it('number and currency: numeric jsonb range on custom_values->key, either side optional', () => {
    expect(
      applyFilter(builder(), { kind: 'number-range', key: 'value', min: 100, max: 500 }).calls,
    ).toEqual([
      ['gte', 'custom_values->value', 100],
      ['lte', 'custom_values->value', 500],
    ])
    expect(
      applyFilter(builder(), { kind: 'number-range', key: 'value', min: null, max: 0 }).calls,
    ).toEqual([['lte', 'custom_values->value', 0]])
  })

  it('date: lexical ISO range on custom_values->>key', () => {
    expect(
      applyFilter(builder(), { kind: 'date-range', key: 'due', min: '2026-01-01', max: null })
        .calls,
    ).toEqual([['gte', 'custom_values->>due', '2026-01-01']])
  })
})

describe('applySort and applyRecordsQuery', () => {
  it('sorts core columns directly and fields by jsonb value, nulls last, id as tie-breaker', () => {
    expect(applySort(builder(), { by: 'title', dir: 'desc' }).calls).toEqual([
      ['order', 'title', { ascending: false, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
    ])
    expect(applySort(builder(), { by: 'f.value', dir: 'asc' }).calls[0]).toEqual([
      'order',
      'custom_values->value',
      { ascending: true, nullsFirst: false },
    ])
  })

  it('combines search, filters (AND) and sort in one chain', () => {
    const b = applyRecordsQuery(builder(), {
      search: 'glob',
      filters: [
        { kind: 'options', key: 'status', values: ['lead'] },
        { kind: 'text', key: 'company', value: 'corp' },
      ],
      sort: { by: 'updated_at', dir: 'desc' },
    })
    expect(b.calls.map(([method]) => method)).toEqual([
      'textSearch',
      'contains',
      'ilike',
      'order',
      'order',
    ])
  })
})
