/**
 * POST /functions/v1/attachment-url                               (contract C1, migration 006)
 *
 * Body:     { attachmentId: uuid }
 * Success:  200 { data: { url: string, expiresAt: string } }
 *           `url` is an absolute signed download URL valid for 60 seconds; Storage answers it with
 *           `Content-Disposition: attachment; filename="<file_name>"`. `expiresAt` is ISO 8601 UTC
 *           (taken just before signing, so it never overstates the lifetime).
 * Errors:   401 unauthorized; 400 validation_error; 404 not_found (no such attachment, not visible
 *           to the caller (other workspace), upload not completed, or object missing: one body
 *           for all); 500 internal.
 *
 * Order: verify JWT -> validate body -> load the row with the caller's client (RLS proves
 * membership; no service-role read decides access) -> sign with the service role. Since
 * migration 006 no client can select from storage.objects in the attachments bucket, so this is
 * the only download path. Not audited (reads are not privileged writes).
 */
import { z } from 'zod'
import { adminClient, requireUser } from '../_shared/auth.ts'
import { AppError, jsonOk } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'
import { parseBody } from '../_shared/validation.ts'

const BUCKET = 'attachments'
const EXPIRES_IN_SECONDS = 60

// z.guid(): the fixed seed ids are not RFC 4122 v4 (see invite-member).
const bodySchema = z.object({ attachmentId: z.guid() })

const notFound = () => new AppError(404, 'not_found', 'Attachment not found')

/**
 * Origin the browser can reach. Hosted projects inject the public `SUPABASE_URL`. The local CLI
 * runtime injects the Docker-internal `http://kong:8000`; there the origin Kong forwarded the
 * request for is used (local development only). `PUBLIC_SUPABASE_URL` overrides both.
 */
function publicOrigin(req: Request): string | null {
  const configured = Deno.env.get('PUBLIC_SUPABASE_URL')
  if (configured) return new URL(configured).origin
  const internal = Deno.env.get('SUPABASE_URL')
  if (!internal) return null
  const url = new URL(internal)
  if (url.hostname !== 'kong') return url.origin
  const host = req.headers.get('x-forwarded-host')
  if (!host) return url.origin
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const port = req.headers.get('x-forwarded-port')
  const withPort = host.includes(':') || !port ? host : `${host}:${port}`
  return `${proto}://${withPort}`
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    const { userClient } = await requireUser(req)
    const { attachmentId } = await parseBody(req, bodySchema)

    const { data: row, error } = await userClient
      .from('attachments')
      .select('id, storage_path, file_name, uploaded_at')
      .eq('id', attachmentId)
      .maybeSingle<{
        id: string
        storage_path: string
        file_name: string
        uploaded_at: string | null
      }>()
    if (error) throw new AppError(500, 'internal', 'Could not load the attachment')
    if (!row || !row.uploaded_at) throw notFound()

    const expiresAt = new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString()
    const { data: signed, error: signError } = await adminClient()
      .storage.from(BUCKET)
      .createSignedUrl(row.storage_path, EXPIRES_IN_SECONDS, { download: row.file_name })
    if (signError || !signed?.signedUrl) {
      const status = (signError as { statusCode?: string | number } | null)?.statusCode
      if (String(status) === '404' || /not.?found/i.test(signError?.message ?? '')) throw notFound()
      console.error('[attachment-url] signing failed', signError?.message)
      throw new AppError(500, 'internal', 'Could not create the download URL')
    }

    let url = signed.signedUrl
    const origin = publicOrigin(req)
    if (origin) {
      const parsed = new URL(url)
      url = origin + parsed.pathname + parsed.search
    }

    return jsonOk({ url, expiresAt }, cors)
  }),
)
