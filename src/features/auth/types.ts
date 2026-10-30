import type { Session, User } from '@supabase/supabase-js'

/** What the sign-up mutation needs; `confirmPassword` is a form-only field. */
export interface SignUpCredentials {
  email: string
  password: string
  fullName: string
}

export interface SignUpResult {
  user: User | null
  session: Session | null
  /** True when Supabase requires the user to confirm the email before signing in. */
  needsEmailConfirmation: boolean
}

/** Result of exchanging a PKCE code on `/auth/callback`. */
export interface AuthCodeExchangeResult {
  session: Session | null
  /** `recovery` when the link came from a password reset email. */
  redirectType: 'recovery' | null
}
