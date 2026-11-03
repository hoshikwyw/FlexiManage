import { skipToken, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { ModuleSummary } from '../types'
import { moduleKeys } from './keys'

export async function fetchModules(workspaceId: string): Promise<ModuleSummary[]> {
  // RLS: `modules_select_member`. Field counts come from a second, cheap query
  // on `field_definitions` (same policy) so the list needs no embedded count.
  const { data: modules, error } = await supabase
    .from('modules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error

  const counts = new Map<string, number>()
  if (modules.length > 0) {
    const { data: fields, error: fieldsError } = await supabase
      .from('field_definitions')
      .select('module_id')
      .eq('workspace_id', workspaceId)
    if (fieldsError) throw fieldsError
    for (const field of fields) {
      counts.set(field.module_id, (counts.get(field.module_id) ?? 0) + 1)
    }
  }

  return modules.map((module) => ({ ...module, fieldCount: counts.get(module.id) ?? 0 }))
}

/** Modules of a workspace ordered by position then name, with their field counts. */
export function useModules(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: moduleKeys.list(workspaceId ?? ''),
    queryFn: workspaceId ? () => fetchModules(workspaceId) : skipToken,
  })
}
