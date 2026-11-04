import { supabase } from '@/lib/supabase'

import type { AttachmentItem, AttachmentRow, UploaderProfile } from '../types'

/** Name of the private Storage bucket (migration 005). */
export const ATTACHMENTS_BUCKET = 'attachments'

export const ATTACHMENT_COLUMNS =
  'id, workspace_id, record_id, file_name, content_type, size_bytes, storage_path, uploaded_by, created_at'

/**
 * The record's attachments, oldest first, with the uploaders' profiles from a
 * second `profiles` query (`uploaded_by` references auth.users, so PostgREST
 * cannot embed them). RLS: members of the workspace read both.
 */
export async function fetchAttachments(
  workspaceId: string,
  recordId: string,
): Promise<AttachmentItem[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('record_id', recordId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  const rows: AttachmentRow[] = data

  const uploaderIds = [
    ...new Set(rows.map((row) => row.uploaded_by).filter((id): id is string => id !== null)),
  ]
  const profiles = new Map<string, UploaderProfile>()
  if (uploaderIds.length > 0) {
    const { data: found, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', uploaderIds)
    if (profilesError) throw profilesError
    for (const profile of found) profiles.set(profile.id, profile)
  }

  return rows.map((row) => ({
    ...row,
    uploader: row.uploaded_by ? (profiles.get(row.uploaded_by) ?? null) : null,
  }))
}
