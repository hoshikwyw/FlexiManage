import { describe, expect, it } from 'vitest'

import type { AuditEventWithActor } from '../types'
import { describeAuditAction, describeAuditEvent } from './audit-labels'

const alice = { id: 'user-a', full_name: 'Alice Example', email: 'alice@example.com' }

function event(overrides: Partial<AuditEventWithActor>): AuditEventWithActor {
  return {
    id: 1,
    workspace_id: 'ws',
    actor_id: alice.id,
    actor: alice,
    action: 'workspace.created',
    entity_type: 'workspace',
    entity_id: 'ws',
    metadata: {},
    created_at: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

describe('describeAuditAction', () => {
  it.each([
    ['workspace.created', { name: 'Pilot Co' }, 'created the workspace "Pilot Co"'],
    ['invitation.created', { invitation_id: 'inv-1', role: 'member' }, 'invited a member (member)'],
    ['invitation.created', { invitation_id: 'inv-1' }, 'invited a member'],
    ['invitation.revoked', { invitation_id: 'inv-1', role: 'admin' }, 'revoked an invitation'],
    [
      'invitation.accepted',
      { invitation_id: 'inv-1', role: 'admin' },
      'joined via invitation (admin)',
    ],
    ['invitation.accepted', {}, 'joined via invitation'],
    [
      'member.role_changed',
      { from: 'member', to: 'admin' },
      "changed a member's role from member to admin",
    ],
  ])('labels %s', (action, metadata, expected) => {
    expect(describeAuditAction(event({ action, metadata, entity_id: 'x' }))).toBe(expected)
  })

  it('distinguishes self-join and self-leave from actions on others', () => {
    expect(
      describeAuditAction(
        event({ action: 'member.added', entity_id: alice.id, metadata: { role: 'owner' } }),
      ),
    ).toBe('joined as owner')
    expect(
      describeAuditAction(
        event({ action: 'member.added', entity_id: 'user-b', metadata: { role: 'member' } }),
      ),
    ).toBe('added a member as member')
    expect(describeAuditAction(event({ action: 'member.removed', entity_id: alice.id }))).toBe(
      'left the workspace',
    )
    expect(
      describeAuditAction(
        event({ action: 'member.removed', entity_id: 'user-b', metadata: { role: 'admin' } }),
      ),
    ).toBe('removed a member (admin)')
  })

  it('never renders an email address from invitation metadata', () => {
    for (const action of ['invitation.created', 'invitation.revoked', 'invitation.accepted']) {
      const label = describeAuditAction(
        event({ action, metadata: { email: 'bob@example.com', role: 'member' } }),
      )
      expect(label).not.toContain('bob@example.com')
    }
  })

  it('falls back to the raw action for unknown events', () => {
    expect(describeAuditAction(event({ action: 'records.exported' }))).toBe('records.exported')
  })
})

describe('describeAuditEvent', () => {
  it('prefixes the actor name and uses "Someone" when the actor is unknown', () => {
    expect(describeAuditEvent(event({ metadata: { name: 'A' } }))).toBe(
      'Alice Example created the workspace "A"',
    )
    expect(
      describeAuditEvent(event({ actor: null, actor_id: null, metadata: { name: 'A' } })),
    ).toBe('Someone created the workspace "A"')
    expect(
      describeAuditEvent(event({ actor: { ...alice, full_name: null }, metadata: { name: 'A' } })),
    ).toBe('alice@example.com created the workspace "A"')
  })
})
