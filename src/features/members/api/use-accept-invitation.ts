import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { workspaceKeys } from '@/features/workspaces/api/keys'
import { supabase } from '@/lib/supabase'

import { parseFunctionError } from '../lib/member-errors'
import type { AcceptInvitationResult } from '../types'
import { memberKeys } from './keys'

/**
 * Calls the `accept-invitation` Edge Function exactly once per token.
 *
 * Modelled as a query keyed by the token (like `useExchangeAuthCode`): React
 * StrictMode mounts the page twice in development and a mutation in an effect
 * would fire twice; the second call would answer 404 because the token is
 * already used. `retry: false` because every error here is final.
 *
 * On success the workspace list is refetched before the query resolves so the
 * page can navigate to `/w/:workspaceId` without the route rejecting it.
 */
export function useAcceptInvitation(token: string | undefined) {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useQuery({
    queryKey: memberKeys.accept(token ?? ''),
    enabled: typeof token === 'string' && token.length > 0,
    queryFn: async (): Promise<AcceptInvitationResult> => {
      const { data, error } = await supabase.functions.invoke<{ data: AcceptInvitationResult }>(
        'accept-invitation',
        { body: { token } },
      )
      if (error) throw await parseFunctionError(error)
      if (!data?.data) throw await parseFunctionError(new Error('Empty response'))
      if (user) await queryClient.invalidateQueries({ queryKey: workspaceKeys.list(user.id) })
      return data.data
    },
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
