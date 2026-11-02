import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { memberKeys } from '@/features/members/api/keys'
import { supabase } from '@/lib/supabase'

import { WorkspaceNotFoundError } from '../lib/workspace-errors'
import { workspaceKeys } from './keys'

/**
 * Deletes a workspace (owner only per RLS `workspaces_delete_owner`); members,
 * invitations and audit events cascade. A delete that RLS filters to zero rows
 * is not an error for Postgres, so the hook asks for the deleted ids and
 * throws `WorkspaceNotFoundError` when none came back.
 *
 * The workspace list is invalidated without awaiting: the caller navigates
 * away (`routeAfterLeavingWorkspace`) as soon as the mutation resolves, before
 * the refetch can drop the workspace under the page that is still showing it.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async (workspaceId: string): Promise<string> => {
      const { data, error } = await supabase
        .from('workspaces')
        .delete()
        .eq('id', workspaceId)
        .select('id')
      if (error) throw error
      if (data.length === 0) throw new WorkspaceNotFoundError()
      return workspaceId
    },
    onSuccess: (workspaceId) => {
      queryClient.removeQueries({ queryKey: workspaceKeys.detail(workspaceId) })
      queryClient.removeQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
      queryClient.removeQueries({ queryKey: memberKeys.members(workspaceId) })
      queryClient.removeQueries({ queryKey: memberKeys.invitations(workspaceId) })
      if (user) void queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
    },
  })
}
