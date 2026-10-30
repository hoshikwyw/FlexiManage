import { AuthError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { getAuthCallbackUrl } from '../lib/auth-redirects'
import type { SignUpCredentials, SignUpResult } from '../types'
import { authKeys } from './keys'

export function useSignUp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, password, fullName }: SignUpCredentials): Promise<SignUpResult> => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Read by the `handle_new_user` trigger (migration 001) as
          // `raw_user_meta_data ->> 'full_name'` to fill profiles.full_name.
          data: { full_name: fullName },
          emailRedirectTo: getAuthCallbackUrl(),
        },
      })
      if (error) throw error

      // With email confirmation enabled, Supabase hides "already registered"
      // behind a fake user with no identities to prevent enumeration. Surface it
      // as the same error the unconfirmed flow returns.
      if (data.user && data.user.identities?.length === 0) {
        throw new AuthError('User already registered', 422, 'user_already_exists')
      }

      return {
        user: data.user,
        session: data.session,
        needsEmailConfirmation: data.session === null,
      }
    },
    onSuccess: ({ session }) => {
      if (session) queryClient.setQueryData(authKeys.session, session)
    },
  })
}
