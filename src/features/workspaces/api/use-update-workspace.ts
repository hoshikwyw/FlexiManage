import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { supabase } from '@/lib/supabase'
import type { Workspace } from '@/types/database'

import type { UpdateWorkspaceInput } from '../schemas/workspace'
import { workspaceKeys } from './keys'

/**
 * Renames a workspace or changes its slug. The column grant only allows
 * `name` and `slug`; RLS (`workspaces_update_owner_admin`) rejects members.
 * `.single()` turns a zero-row update (RLS hid the row) into `PGRST116`.
 */
export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async ({ name, slug }: UpdateWorkspaceInput): Promise<Workspace> => {
      const { data, error } = await supabase
        .from('workspaces')
        .update({ name, slug })
        .eq('id', workspaceId)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.detail(workspace.id), workspace)
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspace.id) })
      if (user) void queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
    },
  })
}
