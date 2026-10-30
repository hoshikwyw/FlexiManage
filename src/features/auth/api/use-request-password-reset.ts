import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { getAuthCallbackUrl } from '../lib/auth-redirects'
import type { RequestPasswordResetInput } from '../schemas/auth'

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async ({ email }: RequestPasswordResetInput) => {
      // With PKCE, supabase-js remembers that this code verifier belongs to a
      // recovery flow, so the callback exchange reports `redirectType: 'recovery'`.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getAuthCallbackUrl(),
      })
      if (error) throw error
    },
  })
}
