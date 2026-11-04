import { skipToken, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { WorkspaceUsageRow } from '@/types/database'

import { moduleKeys } from './keys'

export const EMPTY_WORKSPACE_USAGE: WorkspaceUsageRow = {
  modules: 0,
  records: 0,
  members: 0,
  attachments: 0,
  storage_bytes: 0,
}

export async function fetchWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsageRow> {
  // `workspace_usage` is security definer and raises 42501 for non-members.
  const { data, error } = await supabase.rpc('workspace_usage', { p_workspace_id: workspaceId })
  if (error) throw error
  return data[0] ?? EMPTY_WORKSPACE_USAGE
}

/**
 * Usage of a workspace (`['usage', workspaceId]`): modules, records, members,
 * attachments and storage_bytes (sum of the attachments' declared sizes).
 * Record and attachment writes invalidate it.
 */
export function useWorkspaceUsage(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: moduleKeys.usage(workspaceId ?? ''),
    queryFn: workspaceId ? () => fetchWorkspaceUsage(workspaceId) : skipToken,
  })
}
