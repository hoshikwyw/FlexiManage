import { describe, expect, it } from 'vitest'

import { canManageModules } from './module-permissions'

describe('canManageModules', () => {
  it('allows owners and admins only', () => {
    expect(canManageModules('owner')).toBe(true)
    expect(canManageModules('admin')).toBe(true)
    expect(canManageModules('member')).toBe(false)
    expect(canManageModules(null)).toBe(false)
    expect(canManageModules(undefined)).toBe(false)
  })
})
