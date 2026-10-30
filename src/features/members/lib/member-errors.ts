import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'

import { NETWORK_ERROR_MESSAGE, isNetworkError, isPostgrestError } from '@/lib/postgrest-errors'

import type { FunctionErrorCode } from '../types'

/** Codes the members UI distinguishes: the function codes plus local ones. */
export type MemberErrorCode = FunctionErrorCode | 'last_owner' | 'network'

const FUNCTION_ERROR_CODES: ReadonlySet<string> = new Set<FunctionErrorCode>([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'invitation_expired',
  'method_not_allowed',
  'internal',
])

/**
 * Normalised failure of a member action (Edge Function or direct table write).
 * Hooks throw this so components and `getMemberErrorMessage` switch on `code`
 * and never on message text.
 */
export class MemberActionError extends Error {
  readonly code: MemberErrorCode
  readonly status: number | null

  constructor(code: MemberErrorCode, message?: string, status: number | null = null) {
    super(message ?? code)
    this.name = 'MemberActionError'
    this.code = code
    this.status = status
  }
}

const STATUS_TO_CODE: Record<number, FunctionErrorCode> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  410: 'invitation_expired',
  500: 'internal',
}

/**
 * Turns a `supabase.functions.invoke` error into a `MemberActionError`.
 * `FunctionsHttpError.context` is the `Response`; its body is the envelope
 * `{ error: { code, message } }`. When the body is not ours (for example the
 * edge runtime's own 401 for a bad JWT) the HTTP status decides the code.
 */
export async function parseFunctionError(error: unknown): Promise<MemberActionError> {
  if (error instanceof MemberActionError) return error
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined
    const status = typeof response?.status === 'number' ? response.status : null
    let code: FunctionErrorCode | null = null
    let message: string | undefined
    try {
      const body = (await response?.json()) as
        { error?: { code?: unknown; message?: unknown } } | undefined
      const bodyCode = body?.error?.code
      if (typeof bodyCode === 'string' && FUNCTION_ERROR_CODES.has(bodyCode)) {
        code = bodyCode as FunctionErrorCode
      }
      if (typeof body?.error?.message === 'string') message = body.error.message
    } catch {
      // Not JSON: fall through to the status mapping.
    }
    code ??= (status !== null ? STATUS_TO_CODE[status] : undefined) ?? 'internal'
    return new MemberActionError(code, message, status)
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new MemberActionError('network', error.message)
  }
  if (isNetworkError(error)) return new MemberActionError('network')
  return new MemberActionError('internal', error instanceof Error ? error.message : undefined)
}

/** Maps a Postgres error from a direct members/invitations write to a `MemberActionError`. */
export function memberErrorFromPostgrest(error: unknown): MemberActionError {
  if (error instanceof MemberActionError) return error
  if (isPostgrestError(error)) {
    if (error.code === 'P0001' && /last owner/i.test(error.message)) {
      return new MemberActionError('last_owner', error.message)
    }
    if (error.code === '42501') return new MemberActionError('forbidden', error.message)
    if (error.code === 'PGRST116') return new MemberActionError('not_found', error.message)
    if (error.code === '23505') return new MemberActionError('conflict', error.message)
    return new MemberActionError('internal', error.message)
  }
  if (isNetworkError(error)) return new MemberActionError('network')
  return new MemberActionError('internal', error instanceof Error ? error.message : undefined)
}

export const MEMBER_ERROR_MESSAGES: Record<MemberErrorCode, string> = {
  validation_error: 'Check the email address and role and try again.',
  unauthorized: 'Your session has expired. Sign in again and retry.',
  forbidden: 'You are not allowed to do this in this workspace.',
  not_found: 'This item no longer exists.',
  conflict: 'This person is already a member of the workspace.',
  invitation_expired: 'This invitation has expired. Ask for a new one.',
  method_not_allowed: 'The request could not be completed. Please try again.',
  internal: 'Something went wrong. Please try again.',
  last_owner: 'A workspace must keep at least one owner. Make someone else an owner first.',
  network: NETWORK_ERROR_MESSAGE,
}

/** Friendly message for anything a member action can throw. */
export function getMemberErrorMessage(error: unknown): string {
  if (error instanceof MemberActionError) return MEMBER_ERROR_MESSAGES[error.code]
  if (isPostgrestError(error)) return MEMBER_ERROR_MESSAGES[memberErrorFromPostgrest(error).code]
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
  return MEMBER_ERROR_MESSAGES.internal
}
