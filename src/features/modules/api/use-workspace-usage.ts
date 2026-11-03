import { skipToken, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { WorkspaceUsage } from '@/types/database'

import { moduleKeys } from './keys'

export async function fetchWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  // `workspace_usage` is security definer and raises 42501 for non-members.
  const { data, error } = await supabase.rpc('workspace_usage', { p_workspace_id: workspaceId })
  if (error) throw error
  return data[0] ?? { modules: 0, records: 0, members: 0 }
}

/** Module, record and member counts of a workspace (`['usage', workspaceId]`). */
export function useWorkspaceUsage(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: moduleKeys.usage(workspaceId ?? ''),
    queryFn: workspaceId ? () => fetchWorkspaceUsage(workspaceId) : skipToken,
  })
}
