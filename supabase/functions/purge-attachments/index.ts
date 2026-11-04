/**
 * POST /functions/v1/purge-attachments            (operators only: service-role key)
 *
 * Body:     {} or { limit?: 1..1000 }   (default 200 queue entries per call)
 * Success:  200 { data: { purged, failed, remaining } }
 * Errors:   401 unauthorized (no bearer), 403 forbidden (bearer is not the service-role
 *           key, e.g. a user JWT), 400 validation_error, 500 internal.
 *
 * Drains `public.storage_deletion_queue` (migration 005). Every deleted `attachments` row
 * (direct delete, or cascade from a record, module or workspace delete) enqueues its object;
 * Postgres cannot call the Storage API and storage.objects refuses direct SQL deletes, so this
 * function removes the objects through the Storage API with the service-role client:
 *
 *   1. read the oldest `limit` queue entries (attempts < 10);
 *   2. skip (and dequeue) entries whose name belongs to a live attachments row again
 *      (impossible by construction: storage_path contains the row id; defensive only);
 *   3. `storage.from(bucket).remove(names)` per bucket (removing a missing object is not an
 *      error, so the call is idempotent and safe to run concurrently or repeatedly);
 *   4. delete the processed queue rows; on failure increment `attempts` and keep `last_error`.
 *
 * Schedule (Phase 5): call every 10 minutes from pg_cron + pg_net or a GitHub Actions cron
 * with the service-role key from secrets; see docs/operations.md, "Attachments bucket".
 * Not audited: it removes bytes whose deletion was already audited (`attachment.removed`).
 */
import { z } from 'zod'
import { adminClient, requireServiceRole } from '../_shared/auth.ts'
import { AppError, jsonOk } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'

const bodySchema = z.object({ limit: z.number().int().min(1).max(1000).optional() }).strict()

const MAX_ATTEMPTS = 10

interface QueueRow {
  id: number
  bucket_id: string
  object_name: string
  attempts: number
}

async function readBody(req: Request): Promise<z.output<typeof bodySchema>> {
  const text = await req.text()
  if (text.trim() === '') return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AppError(400, 'validation_error', 'Request body must be valid JSON')
  }
  const result = bodySchema.safeParse(raw)
  if (!result.success) {
    throw new AppError(
      400,
      'validation_error',
      'Invalid request body',
      z.flattenError(result.error),
    )
  }
  return result.data
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    requireServiceRole(req)
    const body = await readBody(req)
    const limit = body.limit ?? 200
    const admin = adminClient()

    const { data: queue, error: queueError } = await admin
      .from('storage_deletion_queue')
      .select('id, bucket_id, object_name, attempts')
      .lt('attempts', MAX_ATTEMPTS)
      .order('enqueued_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit)
    if (queueError) throw new AppError(500, 'internal', 'Could not read the deletion queue')

    const rows = (queue ?? []) as QueueRow[]
    let purged = 0
    let failed = 0

    // Defensive: never remove an object that a live row points at.
    const names = rows.map((row) => row.object_name)
    const live = new Set<string>()
    if (names.length > 0) {
      const { data: liveRows, error: liveError } = await admin
        .from('attachments')
        .select('storage_path')
        .in('storage_path', names)
      if (liveError) throw new AppError(500, 'internal', 'Could not check attachments')
      for (const row of liveRows ?? []) live.add((row as { storage_path: string }).storage_path)
    }

    const byBucket = new Map<string, QueueRow[]>()
    for (const row of rows) {
      const list = byBucket.get(row.bucket_id) ?? []
      list.push(row)
      byBucket.set(row.bucket_id, list)
    }

    for (const [bucket, entries] of byBucket) {
      const toRemove = entries.filter((e) => !live.has(e.object_name))
      let ok = true
      let message = ''
      if (toRemove.length > 0) {
        const { error } = await admin.storage
          .from(bucket)
          .remove(toRemove.map((e) => e.object_name))
        if (error) {
          ok = false
          message = error.message.slice(0, 500)
        }
      }
      const ids = entries.map((e) => e.id)
      if (ok) {
        const { error } = await admin.from('storage_deletion_queue').delete().in('id', ids)
        if (error) throw new AppError(500, 'internal', 'Could not update the deletion queue')
        purged += toRemove.length
      } else {
        console.error('[purge-attachments] remove failed', bucket, message)
        failed += entries.length
        for (const entry of entries) {
          await admin
            .from('storage_deletion_queue')
            .update({
              attempts: entry.attempts + 1,
              last_error: message,
              last_attempt_at: new Date().toISOString(),
            })
            .eq('id', entry.id)
        }
      }
    }

    const { count, error: countError } = await admin
      .from('storage_deletion_queue')
      .select('id', { count: 'exact', head: true })
    if (countError) throw new AppError(500, 'internal', 'Could not count the deletion queue')

    return jsonOk({ purged, failed, remaining: count ?? 0 }, cors)
  }),
)
