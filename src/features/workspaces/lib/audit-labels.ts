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

/** `(role)` suffix when the metadata names a role, otherwise nothing. */
function roleSuffix(value: unknown): string {
  return typeof value === 'string' && value ? ` (${value})` : ''
}

/**
 * Human-readable fragment for an audit action, e.g. `invited a member (admin)`.
 * Invitation events carry `invitation_id` and `role` but never the invitee's
 * email (migration 003), so the label never names a person. Unknown actions
 * fall back to the raw action so new server events are still visible.
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
      return `invited a member${roleSuffix(m.role)}`
    case 'invitation.revoked':
      return 'revoked an invitation'
    case 'invitation.accepted':
      return `joined via invitation${roleSuffix(m.role)}`
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
