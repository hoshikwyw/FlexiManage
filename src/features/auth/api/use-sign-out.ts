import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { authKeys, isUserScopedQuery } from './keys'

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onSuccess: () => {
      // `useAuthStateSync` does the same on SIGNED_OUT; doing it here as well
      // makes the redirect immediate instead of waiting for the event.
      queryClient.setQueryData(authKeys.session, null)
      queryClient.removeQueries({ predicate: (query) => isUserScopedQuery(query.queryKey) })
    },
  })
}
