import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { Workspace } from '@/types/database'

import { workspaceKeys } from './keys'

export async function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  // RLS: `workspaces_select_member`; a non-member gets PGRST116 (zero rows).
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single()
  if (error) throw error
  return data
}

/** One workspace by id. Disabled until an id is known. */
export function useWorkspace(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceKeys.detail(workspaceId ?? ''),
    queryFn: () => fetchWorkspace(workspaceId!),
    enabled: typeof workspaceId === 'string' && workspaceId.length > 0,
  })
}
