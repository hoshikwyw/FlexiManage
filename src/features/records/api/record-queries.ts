import { isPostgrestError } from '@/lib/postgrest-errors'
import { supabase } from '@/lib/supabase'

import { applyRecordsCriteria, applyRecordsQuery } from '../lib/records-filters'
import type { RecordItem, RecordsPage, RecordsQuery } from '../types'

/**
 * Raw reads behind the records hooks (no React), so a backend API can replace
 * them without touching the UI. Every query is a plain select on `records`
 * under RLS (`records_select_member`) and also filters on `workspace_id` and
 * `module_id` explicitly.
 */

/*
 * Embeds: `records` has two foreign keys to `modules` (`records_module_id_fkey`
 * on module_id and the composite `records_module_workspace_fkey` on
 * (module_id, workspace_id)), so a bare `modules(*)` embed is ambiguous
 * (PostgREST PGRST201). Always name the FK:
 * `select('..., modules!records_module_workspace_fkey(name)')`, and the same in
 * the other direction (`records!records_module_workspace_fkey(...)`).
 */

/** Every column except `search_vector` (a tsvector the UI never needs). */
export const RECORD_COLUMNS =
  'id, workspace_id, module_id, title, status, custom_values, created_by, created_at, updated_at'

/** Cap on one page (B3): a client never pulls a whole module at once. */
export const MAX_PAGE_SIZE = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

export async function fetchRecords(
  workspaceId: string,
  moduleId: string,
  query: RecordsQuery,
): Promise<RecordsPage> {
  const size = Math.min(query.pageSize, MAX_PAGE_SIZE)
  const from = (Math.max(1, query.page) - 1) * size
  const base = supabase
    .from('records')
    .select(RECORD_COLUMNS, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('module_id', moduleId)
  const { data, count, error } = await applyRecordsQuery(base, query).range(from, from + size - 1)
  if (error) {
    // PGRST103: the page lies past the end (rows were deleted or the URL is
    // stale). Count the matches so the caller can jump to the last page.
    if (isPostgrestError(error) && error.code === 'PGRST103') {
      return { rows: [], total: await countRecords(workspaceId, moduleId, query), outOfRange: true }
    }
    throw error
  }
  return { rows: data, total: count ?? data.length }
}

export async function countRecords(
  workspaceId: string,
  moduleId: string,
  query: Pick<RecordsQuery, 'search' | 'filters'>,
): Promise<number> {
  const base = supabase
    .from('records')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('module_id', moduleId)
  const { count, error } = await applyRecordsCriteria(base, query)
  if (error) throw error
  return count ?? 0
}

/** One record; null when it does not exist or belongs to another workspace or module. */
export async function fetchRecord(
  workspaceId: string,
  moduleId: string,
  recordId: string,
): Promise<RecordItem | null> {
  if (!isUuid(recordId)) return null
  const { data, error } = await supabase
    .from('records')
    .select(RECORD_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('module_id', moduleId)
    .eq('id', recordId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Record count per module: one `head: true` exact count per module, run in
 * parallel. Cheap for the MVP's handful of modules per workspace (no rows are
 * transferred); a grouped count view or RPC can replace it when module counts
 * grow.
 */
export async function fetchRecordCounts(
  workspaceId: string,
  moduleIds: readonly string[],
): Promise<Record<string, number>> {
  const results = await Promise.all(
    moduleIds.map(async (moduleId) => {
      const { count, error } = await supabase
        .from('records')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('module_id', moduleId)
      if (error) throw error
      return [moduleId, count ?? 0] as const
    }),
  )
  return Object.fromEntries(results)
}
