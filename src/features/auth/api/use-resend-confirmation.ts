import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

import { getAuthCallbackUrl } from '../lib/auth-redirects'

/** Re-sends the sign-up confirmation email for an unconfirmed account. */
export function useResendConfirmation() {
  return useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: getAuthCallbackUrl() },
      })
      if (error) throw error
    },
  })
}
