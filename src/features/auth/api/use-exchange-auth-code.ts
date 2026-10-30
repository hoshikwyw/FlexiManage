import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import type { AuthCodeExchangeResult } from '../types'
import { authKeys } from './keys'

/**
 * Exchanges the PKCE `code` from an email link for a session.
 *
 * Modelled as a query keyed by the code so the exchange runs exactly once even
 * when React StrictMode mounts the callback page twice: a code can only be
 * redeemed once and the second attempt would fail with `bad_code_verifier`.
 */
export function useExchangeAuthCode(code: string | null) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: authKeys.callback(code ?? ''),
    enabled: code !== null,
    queryFn: async (): Promise<AuthCodeExchangeResult> => {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code!)
      if (error) throw error
      queryClient.setQueryData(authKeys.session, data.session)
      // supabase-js returns `redirectType` ('recovery' for password reset links,
      // remembered next to the PKCE verifier) but does not declare it in
      // `AuthTokenResponse`; read it defensively.
      const { redirectType } = data as { redirectType?: string | null }
      return {
        session: data.session,
        redirectType: redirectType === 'recovery' ? 'recovery' : null,
      }
    },
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
