import type { RecordFilter, RecordSort, RecordsQuery } from '../types'
import { sortFieldKey } from './records-query'

/**
 * Turns the list view state into PostgREST calls. Kept free of Supabase
 * imports: it receives any builder with the filter methods below (the real
 * `PostgrestFilterBuilder` or a test double) and returns it, so the chained
 * calls can be asserted and a future API can reuse the same rules.
 *
 * - Text filters: `custom_values->>key ilike %value%` (case-insensitive contains).
 * - Options: one value -> `custom_values @> {key: value}` (GIN `jsonb_path_ops`
 *   index); several -> `custom_values->>key in (...)`.
 * - Boolean: `custom_values @> {key: true|false}`; records without a value
 *   match neither.
 * - Number and currency ranges: `custom_values->key gte/lte <n>`. The `->`
 *   operator keeps the jsonb value, and jsonb compares numbers numerically, so
 *   no cast is needed. jsonb `null` sorts below every number, so a "max only"
 *   range also matches a stored JSON null; the app never stores null (see
 *   `compactCustomValues`), only foreign writers could.
 * - Date ranges: `custom_values->>key gte/lte 'YYYY-MM-DD'`: ISO dates compare
 *   correctly as text.
 * - Search: `search_vector @@ to_tsquery('simple', 'w1:* & w2:*')`, falling
 *   back to `title ilike %term%` when the term has no letters or digits.
 * - Sort: core columns directly; custom fields by `custom_values->key` (jsonb
 *   ordering: numbers numerically, strings by collation, false before true).
 *   Select fields sort by stored option value, not by label. Ties are broken
 *   by `id` so pages never overlap.
 */
export interface RecordsQueryBuilder<Self> {
  ilike(column: string, pattern: string): Self
  gte(column: string, value: unknown): Self
  lte(column: string, value: unknown): Self
  contains(column: string, value: Record<string, unknown>): Self
  in(column: string, values: readonly string[]): Self
  textSearch(column: string, query: string, options?: { config?: string }): Self
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Self
}

/** Maximum number of words turned into the prefix query. */
const MAX_SEARCH_WORDS = 8
const WORD = /[\p{L}\p{M}\p{N}]+/gu

/**
 * Prefix tsquery for a free-text search: every run of letters, marks and
 * digits becomes `word:*`, joined with `&`. Anything else (quotes, colons,
 * ampersands, parentheses, `!`, `|`) is dropped, so user input can never form
 * tsquery syntax. Null when the term has no word characters.
 */
export function buildPrefixTsQuery(term: string): string | null {
  const words = term.normalize('NFC').toLowerCase().match(WORD) ?? []
  const unique = [...new Set(words)].slice(0, MAX_SEARCH_WORDS)
  return unique.length > 0 ? unique.map((word) => `${word}:*`).join(' & ') : null
}

/** Escapes LIKE wildcards (`\`, `%`, `_`) so the term matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`
}

export function customValuePath(key: string, asText: boolean): string {
  return `custom_values${asText ? '->>' : '->'}${key}`
}

export function applySearch<B extends RecordsQueryBuilder<B>>(builder: B, term: string): B {
  const trimmed = term.trim()
  if (!trimmed) return builder
  const tsQuery = buildPrefixTsQuery(trimmed)
  return tsQuery
    ? builder.textSearch('search_vector', tsQuery, { config: 'simple' })
    : builder.ilike('title', containsPattern(trimmed))
}

export function applyFilter<B extends RecordsQueryBuilder<B>>(builder: B, filter: RecordFilter): B {
  switch (filter.kind) {
    case 'text':
      return builder.ilike(customValuePath(filter.key, true), containsPattern(filter.value))
    case 'options':
      if (filter.values.length === 1) {
        return builder.contains('custom_values', { [filter.key]: filter.values[0] })
      }
      return builder.in(customValuePath(filter.key, true), filter.values)
    case 'boolean':
      return builder.contains('custom_values', { [filter.key]: filter.value })
    case 'number-range':
    case 'date-range': {
      const path = customValuePath(filter.key, filter.kind === 'date-range')
      let next = builder
      if (filter.min !== null) next = next.gte(path, filter.min)
      if (filter.max !== null) next = next.lte(path, filter.max)
      return next
    }
  }
}

export function applySort<B extends RecordsQueryBuilder<B>>(builder: B, sort: RecordSort): B {
  const ascending = sort.dir === 'asc'
  const key = sortFieldKey(sort.by)
  const column = key !== null ? customValuePath(key, false) : sort.by
  return builder.order(column, { ascending, nullsFirst: false }).order('id', { ascending: true })
}

/** Search, every filter (AND) and the sort, in that order. Paging is applied by the caller. */
export function applyRecordsQuery<B extends RecordsQueryBuilder<B>>(
  builder: B,
  query: Pick<RecordsQuery, 'search' | 'filters' | 'sort'>,
): B {
  let next = applySearch(builder, query.search)
  for (const filter of query.filters) next = applyFilter(next, filter)
  return applySort(next, query.sort)
}

/** Same without the sort, for the head-only count after an out-of-range page. */
export function applyRecordsCriteria<B extends RecordsQueryBuilder<B>>(
  builder: B,
  query: Pick<RecordsQuery, 'search' | 'filters'>,
): B {
  let next = applySearch(builder, query.search)
  for (const filter of query.filters) next = applyFilter(next, filter)
  return next
}
