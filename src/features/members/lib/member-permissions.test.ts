import { describe, expect, it } from 'vitest'

import {
  canChangeRole,
  canInvite,
  canManageInvitations,
  canRemoveMember,
  invitableRoles,
} from './member-permissions'

describe('invite permissions (policy matrix: invitations)', () => {
  it('lets owners and admins invite, members not', () => {
    expect(canInvite('owner')).toBe(true)
    expect(canInvite('admin')).toBe(true)
    expect(canInvite('member')).toBe(false)
    expect(canInvite(null)).toBe(false)
    expect(canManageInvitations('member')).toBe(false)
  })

  it('offers all roles to owners, admin and member to admins, nothing to members', () => {
    expect(invitableRoles('owner')).toEqual(['owner', 'admin', 'member'])
    expect(invitableRoles('admin')).toEqual(['admin', 'member'])
    expect(invitableRoles('member')).toEqual([])
    expect(invitableRoles(undefined)).toEqual([])
  })
})

describe('membership permissions (policy matrix: workspace_members)', () => {
  it('only owners change roles, and not their own', () => {
    expect(canChangeRole('owner', { isSelf: false })).toBe(true)
    expect(canChangeRole('owner', { isSelf: true })).toBe(false)
    expect(canChangeRole('admin', { isSelf: false })).toBe(false)
    expect(canChangeRole('member', { isSelf: false })).toBe(false)
  })

  it('anyone may leave; owners remove anyone; admins remove non-owners only', () => {
    expect(canRemoveMember('member', 'member', { isSelf: true })).toBe(true)
    expect(canRemoveMember('owner', 'owner', { isSelf: false })).toBe(true)
    expect(canRemoveMember('admin', 'member', { isSelf: false })).toBe(true)
    expect(canRemoveMember('admin', 'admin', { isSelf: false })).toBe(true)
    expect(canRemoveMember('admin', 'owner', { isSelf: false })).toBe(false)
    expect(canRemoveMember('member', 'member', { isSelf: false })).toBe(false)
    expect(canRemoveMember(null, 'member', { isSelf: false })).toBe(false)
  })
})
