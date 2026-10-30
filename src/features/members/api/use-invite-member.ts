import { useMutation, useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'

import { parseFunctionError } from '../lib/member-errors'
import type { InviteMemberInput } from '../schemas/invite'
import type { InviteMemberResult } from '../types'
import { memberKeys } from './keys'

/**
 * Calls the `invite-member` Edge Function (privileged action: role check,
 * duplicate detection and audit happen server-side). Errors are normalised to
 * `MemberActionError` so the form can map `code` to a message.
 */
export function useInviteMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, role }: InviteMemberInput): Promise<InviteMemberResult> => {
      const { data, error } = await supabase.functions.invoke<{ data: InviteMemberResult }>(
        'invite-member',
        { body: { workspaceId, email, role } },
      )
      if (error) throw await parseFunctionError(error)
      if (!data?.data) throw await parseFunctionError(new Error('Empty response'))
      return data.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKeys.invitations(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.auditAll(workspaceId) })
    },
  })
}
