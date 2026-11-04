/**
 * Typed JSON errors with stable codes. The frontend switches on `error.code`,
 * never on the message text.
 *
 * Success:  { data: ... }
 * Failure:  { error: { code, message, details? } }
 */
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  | 'invitation_expired'
  | 'export_too_large'
  | 'plan_limit_exceeded'
  | 'method_not_allowed'
  | 'internal'

export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type ResponseHeaders = Record<string, string>

function json(body: unknown, status: number, headers: ResponseHeaders): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function jsonOk(data: unknown, headers: ResponseHeaders, status = 200): Response {
  return json({ data }, status, headers)
}

export function jsonError(err: AppError, headers: ResponseHeaders): Response {
  const error: { code: ErrorCode; message: string; details?: unknown } = {
    code: err.code,
    message: err.message,
  }
  if (err.details !== undefined) error.details = err.details
  return json({ error }, err.status, headers)
}

/** DETAIL of a PT402 `plan_limit_exceeded` error (contract C6, migration 007). */
export interface PlanLimitDetails {
  resource: 'members' | 'modules' | 'records' | 'storage_bytes' | 'workspaces'
  limit: number
  current: number
  plan: string
}

/** The fields of a PostgREST / supabase-js error that the mapping needs. */
interface PostgrestLikeError {
  code?: string | null
  message?: string | null
  details?: string | null
}

function parsePlanLimitDetails(raw: string | null | undefined): PlanLimitDetails | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Partial<PlanLimitDetails>
    if (
      typeof value.resource === 'string' &&
      typeof value.limit === 'number' &&
      typeof value.current === 'number' &&
      typeof value.plan === 'string'
    ) {
      return value as PlanLimitDetails
    }
  } catch {
    // Not JSON: fall through.
  }
  return undefined
}

/**
 * Contract C6: Postgres raises SQLSTATE `PT402` with message `plan_limit_exceeded` and DETAIL
 * `{"resource","limit","current","plan"}` when an insert would exceed the workspace's plan.
 * Returns the envelope error (HTTP 402, code `plan_limit_exceeded`, details = the parsed DETAIL)
 * or null for any other error.
 */
export function planLimitError(error: PostgrestLikeError | null | undefined): AppError | null {
  if (!error || error.code !== 'PT402') return null
  const details = parsePlanLimitDetails(error.details)
  const message = details
    ? `Plan limit reached: ${details.resource} ${details.current} of ${details.limit} on the ${details.plan} plan`
    : 'Plan limit reached'
  return new AppError(402, 'plan_limit_exceeded', message, details)
}

/**
 * Normalises anything thrown into an AppError. Unknown errors are logged
 * (message only, never request bodies or headers) and returned as `internal`.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const message = err instanceof Error ? err.message : String(err)
  console.error('[internal]', message)
  return new AppError(500, 'internal', 'Unexpected error')
}
