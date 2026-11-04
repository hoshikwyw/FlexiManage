import { describe, expect, it } from 'vitest'

import { canDeleteAttachment } from './attachment-permissions'
import { uploaderName } from './uploader-name'

describe('canDeleteAttachment', () => {
  const own = { uploaded_by: 'u1' }

  it('lets owners and admins delete any file', () => {
    expect(canDeleteAttachment({ uploaded_by: 'other' }, 'u1', 'owner')).toBe(true)
    expect(canDeleteAttachment({ uploaded_by: null }, 'u1', 'admin')).toBe(true)
  })

  it('lets a member delete only their own uploads', () => {
    expect(canDeleteAttachment(own, 'u1', 'member')).toBe(true)
    expect(canDeleteAttachment({ uploaded_by: 'other' }, 'u1', 'member')).toBe(false)
    expect(canDeleteAttachment({ uploaded_by: null }, 'u1', 'member')).toBe(false)
  })

  it('offers nothing without a role or user', () => {
    expect(canDeleteAttachment(own, 'u1', null)).toBe(false)
    expect(canDeleteAttachment(own, null, 'member')).toBe(false)
  })
})

describe('uploaderName', () => {
  it('says "you", the profile name or email, or "Someone"', () => {
    const profile = { id: 'u2', email: 'bob@example.com', full_name: null }
    expect(uploaderName({ uploaded_by: 'u1', uploader: null }, 'u1')).toBe('you')
    expect(uploaderName({ uploaded_by: 'u2', uploader: profile }, 'u1')).toBe('bob@example.com')
    expect(
      uploaderName({ uploaded_by: 'u2', uploader: { ...profile, full_name: 'Bob B' } }, 'u1'),
    ).toBe('Bob B')
    expect(uploaderName({ uploaded_by: null, uploader: null }, 'u1')).toBe('Someone')
  })
})
