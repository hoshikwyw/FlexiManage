import type { RecordRow } from '@/types/database'

/** A record as the UI reads it: every column except the generated `search_vector`. */
export type RecordItem = Omit<RecordRow, 'search_vector'>

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/** Core columns the list can sort by. */
export const CORE_SORT_COLUMNS = ['title', 'created_at', 'updated_at', 'status'] as const
export type CoreSortColumn = (typeof CORE_SORT_COLUMNS)[number]

/**
 * Sort target: a core column or a custom field as `f.<key>`. The prefix keeps a
 * field whose key is `status` or `title` apart from the core column.
 */
export type RecordSortBy = CoreSortColumn | `f.${string}`
export type SortDirection = 'asc' | 'desc'

export interface RecordSort {
  by: RecordSortBy
  dir: SortDirection
}

/** One active filter on a custom field; the kind comes from the field-type registry. */
export type RecordFilter =
  | { kind: 'text'; key: string; value: string }
  | { kind: 'options'; key: string; values: string[] }
  | { kind: 'boolean'; key: string; value: boolean }
  | { kind: 'number-range'; key: string; min: number | null; max: number | null }
  | { kind: 'date-range'; key: string; min: string | null; max: string | null }

/** View state of the records list; mirrored in the URL by `lib/records-query.ts`. */
export interface RecordsQuery {
  page: number
  pageSize: PageSize
  sort: RecordSort
  search: string
  filters: RecordFilter[]
}

export interface RecordsPage {
  rows: RecordItem[]
  /** Total matching rows (exact count) across all pages. */
  total: number
  /** The requested page lies past the last one (PostgREST `PGRST103`). */
  outOfRange?: boolean
}
