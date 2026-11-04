import { supabase } from '@/lib/supabase'
import type { UpdateRecordResult } from '@/types/database'
import type { Json } from '@/types/supabase'

import { RecordNotFoundError } from '../lib/record-errors'
import type { RecordPatch } from '../lib/record-values'
import type { RecordItem } from '../types'

/** Arguments of `public.update_record(p_record_id, p_expected_updated_at, p_patch)`. */
export interface UpdateRecordArgs {
  p_record_id: string
  /** `updated_at` of the version the edit started from (optimistic concurrency). */
  p_expected_updated_at: string
  p_patch: RecordPatch
}

/** The columns the UI keeps (every column except `search_vector`). */
function toRecordItem(row: UpdateRecordResult): RecordItem {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    module_id: row.module_id,
    title: row.title,
    status: row.status,
    custom_values: row.custom_values,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Applies a patch through `update_record` (typed by the generated
 * `src/types/supabase.ts`), which checks access under RLS, compares
 * `updated_at` with `p_expected_updated_at`, applies `unset` then `set` to
 * `custom_values` server-side and returns the updated row. Errors are thrown
 * as the PostgREST error: `PT409` (`record_changed`) for a conflict, `PT404`
 * for a record that is gone or hidden, `23514` for invalid values, `22023` for
 * a malformed patch.
 */
export async function updateRecordRpc({
  p_record_id,
  p_expected_updated_at,
  p_patch,
}: UpdateRecordArgs): Promise<RecordItem> {
  const patch: Json = p_patch
  const { data, error } = await supabase.rpc('update_record', {
    p_record_id,
    p_expected_updated_at,
    p_patch: patch,
  })
  if (error) throw error
  // Defensive: a set-returning variant would answer an array.
  const row = (Array.isArray(data) ? data[0] : data) as UpdateRecordResult | null | undefined
  if (!row || typeof row !== 'object') throw new RecordNotFoundError()
  return toRecordItem(row)
}
