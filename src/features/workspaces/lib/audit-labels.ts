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

function nested(value: unknown): Metadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Metadata)
    : {}
}

/** `(role)` suffix when the metadata names a role, otherwise nothing. */
function roleSuffix(value: unknown): string {
  return typeof value === 'string' && value ? ` (${value})` : ''
}

/** ` (2 attachments)` / ` (1 attachment)` when the metadata has a count, otherwise nothing. */
function attachmentSuffix(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return ''
  return ` (${value} attachment${value === 1 ? '' : 's'})`
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
    // Migration 004: module and field definition events.
    case 'module.created':
      return `created the module "${text(m.name, 'Untitled')}"`
    case 'module.updated': {
      const from = nested(m.from)
      const to = nested(m.to)
      const fromName = text(from.name, '')
      const toName = text(to.name, '')
      return fromName && toName && fromName !== toName
        ? `renamed the module "${fromName}" to "${toName}"`
        : `updated the module "${text(to.name, 'Untitled')}"`
    }
    case 'module.deleted':
      return `deleted the module "${text(m.name, 'Untitled')}"`
    case 'field.created':
      return `added the field "${text(m.label, text(m.key, 'untitled'))}"`
    case 'field.deleted':
      return `deleted the field "${text(m.label, text(m.key, 'untitled'))}"`
    // Audited server-side with `{ module_id, title, attachment_count }`.
    case 'record.deleted':
      return `deleted the record "${text(m.title, 'Untitled')}"${attachmentSuffix(m.attachment_count)}`
    // Migrations 005 and 006: attachment and export events.
    case 'attachment.added':
      return `attached the file "${text(m.file_name, 'file')}"`
    case 'attachment.removed':
      return `removed the file "${text(m.file_name, 'file')}"`
    case 'attachment.rejected':
      return `had the upload "${text(m.file_name, 'file')}" rejected`
    case 'records.exported':
      return m.filtered === true ? 'exported filtered records to CSV' : 'exported records to CSV'
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
