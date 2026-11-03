import { getSelectOptions } from '@/features/records/fields/field-json'
import { FIELD_TYPE_REGISTRY } from '@/features/records/fields/registry'
import { parseIsoDate } from '@/lib/format'
import type { FieldDefinition } from '@/types/database'

import {
  CORE_SORT_COLUMNS,
  PAGE_SIZES,
  type CoreSortColumn,
  type PageSize,
  type RecordFilter,
  type RecordSort,
  type RecordsQuery,
} from '../types'

/**
 * URL contract of the records list (docs/architecture.md, "Records feature"):
 *
 *   ?q=<search>&page=<n>&size=<25|50|100>&sort=<column|f.key>&dir=<asc|desc>&f.<key>=<value>
 *
 * Filter values by kind: text `f.company=acme`; options repeat the parameter
 * (`f.status=lead&f.status=active`); boolean `true`/`false`; number and date
 * ranges `min..max` with either side optional (`f.value=100..`, `f.due=..2026-12-31`).
 * Parsing never throws: invalid values fall back to the defaults and filters
 * on unknown keys are dropped. Serialising omits defaults and keeps unrelated
 * parameters such as `tab`.
 */

export const DEFAULT_PAGE_SIZE: PageSize = 25
export const DEFAULT_SORT: RecordSort = { by: 'updated_at', dir: 'desc' }
export const SEARCH_MAX_LENGTH = 200
export const FILTER_PREFIX = 'f.'
const RANGE_SEPARATOR = '..'

export const DEFAULT_RECORDS_QUERY: RecordsQuery = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: DEFAULT_SORT,
  search: '',
  filters: [],
}

const QUERY_PARAMS = ['q', 'page', 'size', 'sort', 'dir']

export function fieldSortKey(key: string): `f.${string}` {
  return `${FILTER_PREFIX}${key}`
}

/** Field key of a `f.<key>` sort target, or null for a core column. */
export function sortFieldKey(by: string): string | null {
  return by.startsWith(FILTER_PREFIX) ? by.slice(FILTER_PREFIX.length) : null
}

function isCoreSortColumn(value: string): value is CoreSortColumn {
  return (CORE_SORT_COLUMNS as readonly string[]).includes(value)
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d{1,6}$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 ? value : null
}

function parsePageSize(raw: string | null): PageSize {
  const value = Number(raw)
  return (PAGE_SIZES as readonly number[]).includes(value) ? (value as PageSize) : DEFAULT_PAGE_SIZE
}

function parseSort(params: URLSearchParams, fields: readonly FieldDefinition[]): RecordSort {
  const by = params.get('sort')
  const dirParam = params.get('dir')
  if (by === null) return DEFAULT_SORT
  const key = sortFieldKey(by)
  const valid = key !== null ? fields.some((field) => field.key === key) : isCoreSortColumn(by)
  if (!valid) return DEFAULT_SORT
  const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : 'asc'
  return { by: by as RecordSort['by'], dir }
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function parseRange<T>(
  raw: string,
  parseSide: (side: string) => T | null,
): { min: T | null; max: T | null } | null {
  const index = raw.indexOf(RANGE_SEPARATOR)
  if (index === -1) return null
  const minRaw = raw.slice(0, index)
  const maxRaw = raw.slice(index + RANGE_SEPARATOR.length)
  const min = minRaw === '' ? null : parseSide(minRaw)
  const max = maxRaw === '' ? null : parseSide(maxRaw)
  // A side that is present but invalid poisons the whole filter.
  if ((minRaw !== '' && min === null) || (maxRaw !== '' && max === null)) return null
  if (min === null && max === null) return null
  return { min, max }
}

function parseFilter(field: FieldDefinition, values: string[]): RecordFilter | null {
  const kind = FIELD_TYPE_REGISTRY[field.type].filterKind
  const first = values[0] ?? ''
  switch (kind) {
    case 'text': {
      const value = first.trim().slice(0, SEARCH_MAX_LENGTH)
      return value ? { kind, key: field.key, value } : null
    }
    case 'options': {
      const allowed = new Set(getSelectOptions(field).map((option) => option.value))
      const picked = [...new Set(values.filter((value) => allowed.has(value)))]
      return picked.length ? { kind, key: field.key, values: picked } : null
    }
    case 'boolean':
      return first === 'true' || first === 'false'
        ? { kind, key: field.key, value: first === 'true' }
        : null
    case 'number-range': {
      const range = parseRange(first, parseNumber)
      return range ? { kind, key: field.key, ...range } : null
    }
    case 'date-range': {
      const range = parseRange(first, (side) => (parseIsoDate(side) ? side : null))
      return range ? { kind, key: field.key, ...range } : null
    }
  }
}

/** URL search parameters -> list view state, validated against the module's fields. */
export function parseRecordsQuery(
  params: URLSearchParams,
  fields: readonly FieldDefinition[],
): RecordsQuery {
  const filters: RecordFilter[] = []
  for (const field of fields) {
    const values = params.getAll(`${FILTER_PREFIX}${field.key}`)
    if (values.length === 0) continue
    const filter = parseFilter(field, values)
    if (filter) filters.push(filter)
  }
  return {
    page: parsePositiveInt(params.get('page')) ?? 1,
    pageSize: parsePageSize(params.get('size')),
    sort: parseSort(params, fields),
    search: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH),
    filters,
  }
}

function formatRange(min: number | string | null, max: number | string | null): string {
  return `${min ?? ''}${RANGE_SEPARATOR}${max ?? ''}`
}

/** The URL values of one filter (several for multi-option filters). */
export function filterToParamValues(filter: RecordFilter): string[] {
  switch (filter.kind) {
    case 'text':
      return [filter.value]
    case 'options':
      return filter.values
    case 'boolean':
      return [String(filter.value)]
    case 'number-range':
    case 'date-range':
      return [formatRange(filter.min, filter.max)]
  }
}

/**
 * List view state -> URL search parameters. Starts from `base` (so `tab` and
 * other parameters survive), drops every records parameter and writes back
 * only the non-default ones.
 */
export function serialiseRecordsQuery(
  query: RecordsQuery,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams()
  for (const [name, value] of base) {
    if (QUERY_PARAMS.includes(name) || name.startsWith(FILTER_PREFIX)) continue
    params.append(name, value)
  }
  const search = query.search.trim()
  if (search) params.set('q', search)
  for (const filter of query.filters) {
    for (const value of filterToParamValues(filter)) {
      params.append(`${FILTER_PREFIX}${filter.key}`, value)
    }
  }
  if (query.sort.by !== DEFAULT_SORT.by || query.sort.dir !== DEFAULT_SORT.dir) {
    params.set('sort', query.sort.by)
    params.set('dir', query.sort.dir)
  }
  if (query.page > 1) params.set('page', String(query.page))
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(query.pageSize))
  return params
}

/** True when search or any filter narrows the list (drives the "No records match" state). */
export function hasActiveCriteria(query: Pick<RecordsQuery, 'search' | 'filters'>): boolean {
  return query.search.trim() !== '' || query.filters.length > 0
}

/** Replaces (or with null removes) the filter on `key`; always returns to page 1. */
export function withFilter(
  query: RecordsQuery,
  key: string,
  filter: RecordFilter | null,
): RecordsQuery {
  const others = query.filters.filter((entry) => entry.key !== key)
  return { ...query, page: 1, filters: filter ? [...others, filter] : others }
}

/** Search and filters cleared, page 1; sort and page size kept. */
export function withoutCriteria(query: RecordsQuery): RecordsQuery {
  return { ...query, page: 1, search: '', filters: [] }
}

/**
 * Next sort when a header is clicked: the same column flips direction, a new
 * column starts ascending (except `updated_at`/`created_at`, newest first).
 */
export function nextSort(current: RecordSort, by: RecordSort['by']): RecordSort {
  if (current.by === by) return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { by, dir: by === 'updated_at' || by === 'created_at' ? 'desc' : 'asc' }
}
