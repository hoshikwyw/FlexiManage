import { getDisplayName } from '@/features/profile/lib/display-name'

import type { AuditEventWithActor } from '../types'

type Metadata = Record<string, unknown>

function metadataOf(event: AuditEventWithActor): Metadata {
  const value = event.metadata
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Metadata)
    : {}
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

/**
 * Human-readable fragment for an audit action, e.g. `invited bob@example.com
 * as member`. Unknown actions fall back to the raw action so new server
 * events are still visible.
 */
export function describeAuditAction(event: AuditEventWithActor): string {
  const m = metadataOf(event)
  const isSelf = event.actor_id !== null && event.entity_id === event.actor_id
  switch (event.action) {
    case 'workspace.created':
      return `created the workspace "${text(m.name, 'Untitled')}"`
    case 'member.added':
      return isSelf
        ? `joined as ${text(m.role, 'member')}`
        : `added a member as ${text(m.role, 'member')}`
    case 'member.role_changed':
      return `changed a member's role from ${text(m.from, '?')} to ${text(m.to, '?')}`
    case 'member.removed':
      return isSelf ? 'left the workspace' : `removed a member (${text(m.role, 'member')})`
    case 'invitation.created':
      return `invited ${text(m.email, 'someone')} as ${text(m.role, 'member')}`
    case 'invitation.revoked':
      return `revoked the invitation for ${text(m.email, 'someone')}`
    case 'invitation.accepted':
      return `accepted an invitation as ${text(m.role, 'member')}`
    default:
      return event.action
  }
}

/** Actor display name, or "Someone" when the actor is unknown or hidden by RLS. */
export function describeAuditActor(event: AuditEventWithActor): string {
  if (!event.actor) return 'Someone'
  return getDisplayName(event.actor)
}

export function describeAuditEvent(event: AuditEventWithActor): string {
  return `${describeAuditActor(event)} ${describeAuditAction(event)}`
}
