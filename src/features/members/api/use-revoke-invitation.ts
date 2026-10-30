import { useMutation, useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'

import { MemberActionError, memberErrorFromPostgrest } from '../lib/member-errors'
import { memberKeys } from './keys'

/**
 * Revokes a pending invitation: a direct delete under RLS
 * (`invitations_delete_owner_admin`); the trigger writes `invitation.revoked`.
 * Zero deleted rows means RLS hid the row (or it is gone) and is reported as
 * `not_found`.
 */
export function useRevokeInvitation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string): Promise<string> => {
      const { data, error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', invitationId)
        .eq('workspace_id', workspaceId)
        .select('id')
      if (error) throw memberErrorFromPostgrest(error)
      if (data.length === 0) throw new MemberActionError('not_found')
      return invitationId
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.invitations(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
