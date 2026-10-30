import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from './errors.ts'

export interface AuditEvent {
  workspaceId: string
  actorId: string | null
  /** Dotted verb, e.g. `records.exported`. */
  action: string
  entityType: string
  entityId?: string | null
  /** Never include tokens, secrets or full records. */
  metadata?: Record<string, unknown>
}

/**
 * Writes one `audit_events` row with the service-role client (clients have no
 * insert grant). Use it for privileged writes that no database trigger covers;
 * do not double-log actions that already have a trigger.
 */
export async function writeAudit(admin: SupabaseClient, event: AuditEvent): Promise<void> {
  const { error } = await admin.from('audit_events').insert({
    workspace_id: event.workspaceId,
    actor_id: event.actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    metadata: event.metadata ?? {},
  })
  if (error) throw new AppError(500, 'internal', 'Could not write audit event')
}
