import type { PostgrestError } from '@supabase/supabase-js'

/** Narrow an unknown rejection to a PostgREST/Postgres error (has a string `code` and `message`). */
export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  )
}

/** Browser `fetch` rejections (offline, DNS, CORS) surface as a TypeError. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network/i.test(error.message)
}

export const NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.'
