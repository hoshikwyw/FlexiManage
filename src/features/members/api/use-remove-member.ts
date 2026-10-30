import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'

import { MemberActionError, memberErrorFromPostgrest } from '../lib/member-errors'
import { memberKeys } from './keys'

/**
 * Removes a member or leaves the workspace (same delete; RLS
 * `workspace_members_delete_owner_admin_or_self` decides). The last-owner
 * trigger blocks the last owner from leaving (`last_owner`). Zero deleted rows
 * means RLS denied it and is reported as `forbidden`.
 */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async (userId: string): Promise<{ userId: string; isSelf: boolean }> => {
      const { data, error } = await supabase
        .from('workspace_members')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .select('user_id')
      if (error) throw memberErrorFromPostgrest(error)
      if (data.length === 0) throw new MemberActionError('forbidden')
      return { userId, isSelf: user?.id === userId }
    },
    onSuccess: async ({ isSelf }) => {
      if (isSelf) {
        queryClient.removeQueries({ queryKey: memberKeys.members(workspaceId) })
        queryClient.removeQueries({ queryKey: memberKeys.invitations(workspaceId) })
        queryClient.removeQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
        queryClient.removeQueries({ queryKey: workspaceKeys.detail(workspaceId) })
        // Await so the caller can navigate once the workspace list no longer has it.
        if (user) await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
        return
      }
      void queryClient.invalidateQueries({ queryKey: memberKeys.members(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
