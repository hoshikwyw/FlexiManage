import { corsHeaders, handlePreflight } from './cors.ts'
import { AppError, jsonError, toAppError } from './errors.ts'

export interface HandlerContext {
  /** CORS headers to include on every response of this request. */
  cors: Record<string, string>
}

type Handler = (req: Request, ctx: HandlerContext) => Promise<Response>

/**
 * Wraps a function body with CORS preflight, method check and error mapping,
 * so every function returns the same `{ data }` / `{ error }` envelope.
 */
export function createHandler(
  methods: readonly string[],
  fn: Handler,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const preflight = handlePreflight(req)
    if (preflight) return preflight

    const cors = corsHeaders(req)
    try {
      if (!methods.includes(req.method)) {
        throw new AppError(405, 'method_not_allowed', `Use ${methods.join(' or ')}`)
      }
      return await fn(req, { cors })
    } catch (err) {
      return jsonError(toAppError(err), cors)
    }
  }
}
