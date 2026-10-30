import type { Session, User } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { authKeys } from './keys'

async function fetchSession(): Promise<Session | null> {
  // getSession() waits for the client to restore a persisted session from
  // storage, so the first result is already the truth: no sign-in flash.
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export interface UseSessionResult {
  session: Session | null
  user: User | null
  /** True until the first auth state is known. Render a spinner, not the sign-in page. */
  isLoading: boolean
  isAuthenticated: boolean
  error: Error | null
}

/**
 * Current Supabase session from the TanStack Query cache. The cache is kept in
 * sync with `supabase.auth.onAuthStateChange` by `useAuthStateSync`, mounted
 * once in `AppProviders`; this hook only reads.
 */
export function useSession(): UseSessionResult {
  const query = useQuery({
    queryKey: authKeys.session,
    queryFn: fetchSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  const session = query.data ?? null

  return {
    session,
    user: session?.user ?? null,
    isLoading: query.isPending,
    isAuthenticated: session !== null,
    error: query.error,
  }
}
