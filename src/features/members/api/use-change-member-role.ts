import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'
import type { WorkspaceMember, WorkspaceRole } from '@/types/database'

import { memberErrorFromPostgrest } from '../lib/member-errors'
import { memberKeys } from './keys'

export interface ChangeMemberRoleInput {
  userId: string
  role: WorkspaceRole
}

/**
 * Updates `workspace_members.role` (owner only per RLS
 * `workspace_members_update_owner`). The `protect_last_owner` trigger raises
 * `P0001` when the change would leave no owner; mapped to `last_owner`.
 */
export function useChangeMemberRole(workspaceId: string) {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async ({ userId, role }: ChangeMemberRoleInput): Promise<WorkspaceMember> => {
      const { data, error } = await supabase
        .from('workspace_members')
        .update({ role })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .select('*')
        .single()
      if (error) throw memberErrorFromPostgrest(error)
      return data
    },
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.members(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
      // The caller's own role feeds the switcher and the permission checks.
      if (user && member.user_id === user.id) {
        void queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
      }
    },
  })
}
