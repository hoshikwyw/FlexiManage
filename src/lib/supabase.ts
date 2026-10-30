import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/supabase'

/**
 * Browser-side Supabase client.
 *
 * Only the public project URL and anon key are used here. Row Level Security
 * limits what this client can read or write; the service-role key must never
 * be referenced from browser code.
 */
function requireEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill in the values from your Supabase project.`,
    )
  }
  return value
}

export const supabaseUrl = requireEnv('VITE_SUPABASE_URL')
export const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY')

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // PKCE: email links carry `?code=...`, which `/auth/callback` exchanges
    // explicitly (features/auth/api/use-exchange-auth-code.ts). Automatic URL
    // detection is off so the exchange happens exactly once, in one place, and
    // the callback page can route password recovery links to the reset form.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
})
