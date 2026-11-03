import { skipToken, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type { FieldDefinition } from '@/types/database'

import { moduleKeys } from './keys'

export async function fetchFieldDefinitions(
  workspaceId: string,
  moduleId: string,
): Promise<FieldDefinition[]> {
  // RLS: `field_definitions_select_member`. Position order is the order used
  // by the record form, the table and the export alike (B1).
  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('module_id', moduleId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/** Field definitions of a module in position order. */
export function useFieldDefinitions(
  workspaceId: string | null | undefined,
  moduleId: string | null | undefined,
) {
  return useQuery({
    queryKey: moduleKeys.fields(workspaceId ?? '', moduleId ?? ''),
    queryFn:
      workspaceId && moduleId ? () => fetchFieldDefinitions(workspaceId, moduleId) : skipToken,
  })
}
