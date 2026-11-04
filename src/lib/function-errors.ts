import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'

import { isNetworkError } from './postgrest-errors'

/** What a failed `supabase.functions.invoke` call told us, before any feature maps it. */
export interface FunctionFailure {
  /** `error.code` of the project envelope `{ error: { code, message } }`, when the body had one. */
  code: string | null
  /** HTTP status of the response; null when no response arrived. */
  status: number | null
  /** The request never reached the function (offline, DNS, CORS, relay failure). */
  network: boolean
}

/**
 * Reads a `functions.invoke` error. `FunctionsHttpError.context` is the
 * `Response`, whose JSON body is the envelope; bodies that are not ours (the
 * edge runtime's own 401) leave `code` null so the caller falls back to the
 * status. Same rules as `parseFunctionError` in the members feature.
 */
export async function readFunctionError(error: unknown): Promise<FunctionFailure> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response | undefined
    const status = typeof response?.status === 'number' ? response.status : null
    let code: string | null = null
    try {
      const body = (await response?.json()) as { error?: { code?: unknown } } | undefined
      if (typeof body?.error?.code === 'string') code = body.error.code
    } catch {
      // Not JSON: the status decides.
    }
    return { code, status, network: false }
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return { code: null, status: null, network: true }
  }
  return { code: null, status: null, network: isNetworkError(error) }
}
