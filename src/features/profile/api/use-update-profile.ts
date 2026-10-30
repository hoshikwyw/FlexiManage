import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useSession } from '@/features/auth/api/use-session'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/database'

import type { ProfileInput } from '../schemas/profile'
import { profileKeys } from './keys'

/**
 * Updates the caller's own profile. The column grant on `profiles` only allows
 * `full_name` and `avatar_url` for `authenticated`; the UI never sends anything else.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const { user } = useSession()

  return useMutation({
    mutationFn: async ({ fullName }: ProfileInput): Promise<Profile> => {
      if (!user) throw new Error('You must be signed in to update your profile.')
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', user.id)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKeys.detail(profile.id), profile)
      void queryClient.invalidateQueries({ queryKey: profileKeys.detail(profile.id) })
    },
  })
}
