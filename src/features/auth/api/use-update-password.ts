import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { authKeys } from './keys'

export function useUpdatePassword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ password }: { password: string }) => {
      const { data, error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      return data.user
    },
    onSuccess: () => {
      // The USER_UPDATED event refreshes the session in the cache; make sure
      // readers refetch in case the subscription is not mounted (tests).
      void queryClient.invalidateQueries({ queryKey: authKeys.session })
    },
  })
}
