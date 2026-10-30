import { supabaseUrl } from '@/lib/supabase'

export const AUTH_ROUTES = {
  signIn: '/auth/sign-in',
  signUp: '/auth/sign-up',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  verifyEmail: '/auth/verify-email',
  callback: '/auth/callback',
} as const

export const REDIRECT_PARAM = 'redirectTo'

/** Absolute URL Supabase redirects to after an email link is verified. */
export function getAuthCallbackUrl(): string {
  return `${window.location.origin}${AUTH_ROUTES.callback}`
}

/**
 * Only allow same-origin, path-only redirects. Anything else (absolute URLs,
 * protocol-relative `//evil`, auth pages themselves) falls back to the dashboard.
 */
export function getSafeRedirect(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  if (value.startsWith('/auth/')) return fallback
  return value
}

export function buildSignInUrl(redirectTo: string): string {
  const search = new URLSearchParams({ [REDIRECT_PARAM]: redirectTo })
  return `${AUTH_ROUTES.signIn}?${search.toString()}`
}

/**
 * The local Supabase stack captures every email in Mailpit (formerly Inbucket)
 * on port 54324. Returns null when the app is not pointed at a local stack.
 */
export function getLocalMailInboxUrl(): string | null {
  try {
    const url = new URL(supabaseUrl)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return `${url.protocol}//${url.hostname}:54324`
    }
  } catch {
    // Malformed URL: no inbox hint.
  }
  return null
}
