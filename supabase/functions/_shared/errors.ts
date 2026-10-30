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
