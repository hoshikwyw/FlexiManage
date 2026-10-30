import { AuthApiError, AuthError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  GENERIC_AUTH_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  authErrorFromRedirectParams,
  getAuthErrorMessage,
} from './auth-errors'

describe('getAuthErrorMessage', () => {
  it.each([
    ['invalid_credentials', 'Incorrect email or password.'],
    ['email_not_confirmed', 'Confirm your email address before signing in.'],
    ['user_already_exists', 'An account with this email already exists.'],
    ['email_exists', 'An account with this email already exists.'],
    ['weak_password', 'This password is too weak.'],
    ['otp_expired', 'This link has expired or was already used.'],
  ])('maps the %s code to a friendly message', (code, expected) => {
    const error = new AuthApiError('raw server message', 400, code)
    expect(getAuthErrorMessage(error)).toContain(expected)
  })

  it('falls back to message patterns for errors without a code', () => {
    expect(getAuthErrorMessage(new AuthError('Invalid login credentials', 400))).toBe(
      'Incorrect email or password.',
    )
    expect(getAuthErrorMessage(new AuthError('User already registered', 422))).toContain(
      'already exists',
    )
    expect(
      getAuthErrorMessage(new AuthError('Password should be at least 8 characters', 422)),
    ).toContain('too weak')
  })

  it('reports network failures', () => {
    expect(getAuthErrorMessage(new AuthRetryableFetchError('fetch failed', 0))).toBe(
      NETWORK_ERROR_MESSAGE,
    )
    expect(getAuthErrorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('returns a generic message for unknown errors and never leaks raw text', () => {
    expect(getAuthErrorMessage(new AuthError('database error saving new user', 500))).toBe(
      GENERIC_AUTH_ERROR_MESSAGE,
    )
    expect(getAuthErrorMessage('nope')).toBe(GENERIC_AUTH_ERROR_MESSAGE)
    expect(getAuthErrorMessage(undefined)).toBe(GENERIC_AUTH_ERROR_MESSAGE)
  })
})

describe('authErrorFromRedirectParams', () => {
  it('returns null when the redirect carries no error', () => {
    expect(authErrorFromRedirectParams(new URLSearchParams('code=abc'))).toBeNull()
  })

  it('builds an AuthError from GoTrue redirect parameters', () => {
    const params = new URLSearchParams(
      'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    )
    const error = authErrorFromRedirectParams(params)
    expect(error).toBeInstanceOf(AuthError)
    expect(error?.code).toBe('otp_expired')
    expect(getAuthErrorMessage(error)).toContain('expired')
  })
})
