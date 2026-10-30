import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'

import { authKeys, isUserScopedQuery } from './keys'

/**
 * Subscribes once to Supabase auth events and mirrors them into the query
 * cache. Mount it a single time (see `AppProviders`).
 *
 * - Every event writes the session to `['auth', 'session']` (including
 *   `INITIAL_SESSION`, which resolves the initial loading state quickly).
 * - On `SIGNED_OUT`, or when a different user signs in, every user-scoped
 *   query (profile, workspaces, ...) is dropped so no data leaks between users.
 *
 * Do not call Supabase inside the callback: supabase-js warns that it can deadlock.
 */
export function useAuthStateSync(): void {
  const queryClient = useQueryClient()
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null
      const userChanged = lastUserIdRef.current !== null && lastUserIdRef.current !== userId
      lastUserIdRef.current = userId

      queryClient.setQueryData(authKeys.session, session)

      if (event === 'SIGNED_OUT' || userChanged) {
        queryClient.removeQueries({ predicate: (query) => isUserScopedQuery(query.queryKey) })
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient])
}
