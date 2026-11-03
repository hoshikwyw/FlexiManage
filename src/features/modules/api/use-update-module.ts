import { useMutation, useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'
import type { Module } from '@/types/database'

import { moduleKeys } from './keys'

export interface UpdateModuleVariables {
  name: string
  slug: string
  description: string | null
  icon: string | null
}

/**
 * Renames a module or changes slug, description or icon (owner/admin per RLS
 * `modules_update_owner_admin`). `.single()` turns a zero-row update (RLS hid
 * the row) into `PGRST116`.
 */
export function useUpdateModule(workspaceId: string, moduleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateModuleVariables): Promise<Module> => {
      const { data, error } = await supabase
        .from('modules')
        .update(input)
        .eq('workspace_id', workspaceId)
        .eq('id', moduleId)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (module) => {
      queryClient.setQueryData(moduleKeys.detail(workspaceId, module.id), module)
      void queryClient.invalidateQueries({ queryKey: moduleKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
