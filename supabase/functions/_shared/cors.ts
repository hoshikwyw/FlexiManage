/**
 * CORS for browser calls from the SPA.
 *
 * `ALLOWED_ORIGIN` is a single origin or a comma-separated list. The response
 * echoes the request's Origin when it is in the list, otherwise the first
 * configured origin, so browsers on an unknown origin fail the CORS check.
 */
const DEFAULT_ORIGIN = 'http://localhost:5173'

const allowedOrigins: readonly string[] = (Deno.env.get('ALLOWED_ORIGIN') ?? DEFAULT_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

export function corsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get('Origin')
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : (allowedOrigins[0] ?? DEFAULT_ORIGIN)

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Returns a 204 preflight response for OPTIONS requests, otherwise null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}
