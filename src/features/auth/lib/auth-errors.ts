import { AuthError, isAuthError } from '@supabase/supabase-js'

import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'

/**
 * Maps Supabase Auth errors to messages a user can act on.
 * Keep this the only place that knows GoTrue error codes and message strings.
 */
const MESSAGES = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed:
    'Confirm your email address before signing in. Check your inbox for the confirmation link.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password:
    'This password is too weak. Use at least 8 characters with a mix of letters, numbers and symbols.',
  same_password: 'Choose a password that is different from your current one.',
  otp_expired: 'This link has expired or was already used. Request a new one.',
  access_denied: 'This link is invalid or has expired. Request a new one.',
  flow_state_not_found: 'This link is invalid or has expired. Request a new one.',
  flow_state_expired: 'This link has expired. Request a new one.',
  bad_code_verifier:
    'This link must be opened in the same browser where you requested it. Request a new one from this browser.',
  session_not_found: 'Your session has expired. Sign in again.',
  session_expired: 'Your session has expired. Sign in again.',
  refresh_token_not_found: 'Your session has expired. Sign in again.',
  user_not_found: 'No account matches these details.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Check the form and try again.',
  signup_disabled: 'New sign-ups are currently disabled.',
  over_email_send_rate_limit:
    'Too many emails were sent recently. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a few minutes and try again.',
  reauthentication_needed: 'Sign in again to change your password.',
} as const satisfies Record<string, string>

/** Lookup by an arbitrary GoTrue code; unknown codes yield `undefined`. */
const MESSAGES_BY_CODE: Record<string, string | undefined> = MESSAGES

/** Older GoTrue versions return only a message; match the common ones. */
const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, MESSAGES.invalid_credentials],
  [/email not confirmed/i, MESSAGES.email_not_confirmed],
  [/already (been )?registered/i, MESSAGES.user_already_exists],
  [/password should be at least|weak password|password is too weak/i, MESSAGES.weak_password],
  [/different from the old password/i, MESSAGES.same_password],
  [/code verifier/i, MESSAGES.bad_code_verifier],
  [/invalid or has expired/i, MESSAGES.otp_expired],
  [/rate limit/i, MESSAGES.over_request_rate_limit],
]

export const GENERIC_AUTH_ERROR_MESSAGE = 'Something went wrong. Please try again.'

export function getAuthErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    const known = error.code ? MESSAGES_BY_CODE[error.code] : undefined
    if (known) return known
    // Retryable fetch errors (status 0) mean the network or the server is down.
    if (error.status === 0 || error.name === 'AuthRetryableFetchError') {
      return NETWORK_ERROR_MESSAGE
    }
    return matchMessage(error.message) ?? GENERIC_AUTH_ERROR_MESSAGE
  }

  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return NETWORK_ERROR_MESSAGE
  }

  if (error instanceof Error) {
    return matchMessage(error.message) ?? GENERIC_AUTH_ERROR_MESSAGE
  }

  return GENERIC_AUTH_ERROR_MESSAGE
}

function matchMessage(message: string): string | null {
  for (const [pattern, friendly] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return friendly
  }
  return null
}

/**
 * Builds an `AuthError` from the `error`, `error_code` and `error_description`
 * parameters GoTrue appends to a redirect when an email link cannot be used.
 */
export function authErrorFromRedirectParams(params: URLSearchParams): AuthError | null {
  const code = params.get('error_code') ?? params.get('error')
  const description = params.get('error_description')
  if (!code && !description) return null
  return new AuthError(description ?? 'Authentication failed', 400, code ?? undefined)
}
