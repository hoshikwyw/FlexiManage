import { skipToken, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { Module } from '@/types/database'

import { moduleKeys } from './keys'

export async function fetchModule(workspaceId: string, moduleId: string): Promise<Module | null> {
  // RLS filters other workspaces' rows, so an id from workspace B behaves like
  // an unknown id: null, which the page shows as "not found".
  const { data, error } = await supabase
    .from('modules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', moduleId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** One module by id; `data === null` means not found (or not visible). */
export function useModule(
  workspaceId: string | null | undefined,
  moduleId: string | null | undefined,
) {
  return useQuery({
    queryKey: moduleKeys.detail(workspaceId ?? '', moduleId ?? ''),
    queryFn: workspaceId && moduleId ? () => fetchModule(workspaceId, moduleId) : skipToken,
  })
}
