import type { PostgrestError } from '@supabase/supabase-js'

function isPostgrestError(error: unknown): error is PostgrestError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
}

/** Friendly messages for the few failures the profile form can hit. */
export function getProfileErrorMessage(error: unknown): string {
  if (isPostgrestError(error)) {
    switch (error.code) {
      case '42501': // insufficient_privilege (RLS or column grant)
        return 'You are not allowed to change this profile.'
      case 'PGRST116': // zero rows: RLS hid the row or it does not exist
        return 'Your profile could not be found. Sign out and in again.'
      case '23514': // check_violation
        return 'Check the values and try again.'
      default:
        return 'Your profile could not be saved. Please try again.'
    }
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return 'Your profile could not be saved. Please try again.'
}
