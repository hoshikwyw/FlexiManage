import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'

import {
  MEMBER_ERROR_MESSAGES,
  MemberActionError,
  getMemberErrorMessage,
  memberErrorFromPostgrest,
  parseFunctionError,
} from './member-errors'

function httpError(status: number, body: unknown) {
  return new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function pgError(code: string, message: string) {
  return { code, message, details: '', hint: '', name: 'PostgrestError' }
}

describe('parseFunctionError', () => {
  it.each([
    [400, 'validation_error'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [410, 'invitation_expired'],
    [500, 'internal'],
  ] as const)('reads error.code from a %i response envelope', async (status, code) => {
    const error = await parseFunctionError(
      httpError(status, { error: { code, message: 'server text' } }),
    )
    expect(error).toBeInstanceOf(MemberActionError)
    expect(error.code).toBe(code)
    expect(error.status).toBe(status)
  })

  it('falls back to the HTTP status when the body is not the project envelope', async () => {
    const runtime401 = await parseFunctionError(httpError(401, { code: 'UNAUTHORIZED_JWT' }))
    expect(runtime401.code).toBe('unauthorized')

    const notJson = await parseFunctionError(
      new FunctionsHttpError(new Response('<html>', { status: 403 })),
    )
    expect(notJson.code).toBe('forbidden')
  })

  it('treats unknown codes and statuses as internal', async () => {
    const error = await parseFunctionError(httpError(418, { error: { code: 'teapot' } }))
    expect(error.code).toBe('internal')
  })

  it('maps relay and fetch failures to network', async () => {
    expect((await parseFunctionError(new FunctionsFetchError({}))).code).toBe('network')
    expect((await parseFunctionError(new TypeError('Failed to fetch'))).code).toBe('network')
  })
})

describe('memberErrorFromPostgrest', () => {
  it('maps the last-owner trigger (P0001) to last_owner', () => {
    const error = memberErrorFromPostgrest(
      pgError('P0001', 'cannot remove or demote the last owner of workspace 123'),
    )
    expect(error.code).toBe('last_owner')
  })

  it('maps RLS denial, zero rows and duplicates', () => {
    expect(memberErrorFromPostgrest(pgError('42501', 'denied')).code).toBe('forbidden')
    expect(memberErrorFromPostgrest(pgError('PGRST116', 'zero rows')).code).toBe('not_found')
    expect(memberErrorFromPostgrest(pgError('23505', 'dup')).code).toBe('conflict')
    expect(memberErrorFromPostgrest(pgError('P0001', 'some other raise')).code).toBe('internal')
  })
})

describe('getMemberErrorMessage', () => {
  it('returns the message for a MemberActionError code', () => {
    expect(getMemberErrorMessage(new MemberActionError('conflict'))).toBe(
      MEMBER_ERROR_MESSAGES.conflict,
    )
    expect(getMemberErrorMessage(new MemberActionError('last_owner'))).toMatch(/at least one owner/)
    expect(getMemberErrorMessage(new MemberActionError('forbidden'))).toBe(
      MEMBER_ERROR_MESSAGES.forbidden,
    )
  })

  it('maps raw Postgres and network errors too, and never leaks server text', () => {
    expect(getMemberErrorMessage(pgError('P0001', 'last owner'))).toBe(
      MEMBER_ERROR_MESSAGES.last_owner,
    )
    expect(getMemberErrorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
    expect(getMemberErrorMessage(new Error('stack trace'))).toBe(MEMBER_ERROR_MESSAGES.internal)
    expect(getMemberErrorMessage(undefined)).toBe(MEMBER_ERROR_MESSAGES.internal)
  })
})
