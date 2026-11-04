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
 * - Search: `search_vector @@ to_tsquery('simple', 't1:* & t2:*')` over the
 *   tokens of `tokenizeSearch`, falling back to `title ilike %term%` when no
 *   token remains.
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

/** Maximum number of tokens turned into the prefix query. */
const MAX_SEARCH_TOKENS = 8
/** Splits on whitespace and every character that is not a letter, mark, digit or `. @ - _ +`. */
const TOKEN_SEPARATOR = /[^\p{L}\p{M}\p{N}.@\-_+]+/u
/** `. @ - _ +` at either end of a token (kept inside: `12500.5`, `jane@acme.example`). */
const TOKEN_EDGE_PUNCTUATION = /^[.@\-_+]+|[.@\-_+]+$/g

/**
 * Search tokens, identical to `searchTokens` in
 * `supabase/functions/_shared/search.ts` (used by `export-records`) so the
 * list and the export match the same rows: NFC-normalise (composed and
 * decomposed accents agree); split on whitespace and on every character that
 * is not a letter, mark, digit or one of `. @ - _ +`; strip those five from
 * both ends of each token; drop empty tokens; lowercase; dedupe; keep at most 8.
 */
export function tokenizeSearch(term: string): string[] {
  const tokens = term
    .normalize('NFC')
    .split(TOKEN_SEPARATOR)
    .map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, ''))
    .filter((token) => token !== '')
    .map((token) => token.toLowerCase())
  return [...new Set(tokens)].slice(0, MAX_SEARCH_TOKENS)
}

/**
 * Prefix tsquery for a free-text search: each token becomes `token:*`, joined
 * with ` & `. Quotes, colons, ampersands, parentheses, `!`, `|` and `*` are
 * separators, and the kept punctuation (`. @ - _ +`) is not tsquery syntax, so
 * user input can never form operators. Null when no token remains.
 */
export function buildPrefixTsQuery(term: string): string | null {
  const tokens = tokenizeSearch(term)
  return tokens.length > 0 ? tokens.map((token) => `${token}:*`).join(' & ') : null
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
