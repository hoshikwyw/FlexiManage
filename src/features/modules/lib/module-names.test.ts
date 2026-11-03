import { describe, expect, it } from 'vitest'

import { uniqueModuleName } from './module-names'

describe('uniqueModuleName', () => {
  it('keeps a name nobody uses', () => {
    expect(uniqueModuleName('Housekeeping tasks', [{ name: 'Clients', slug: 'clients' }])).toBe(
      'Housekeeping tasks',
    )
  })

  it('suffixes "(2)" when the name or its slug is taken, case-insensitively', () => {
    expect(
      uniqueModuleName('Housekeeping tasks', [{ name: 'housekeeping TASKS', slug: 'hk' }]),
    ).toBe('Housekeeping tasks (2)')
    expect(
      uniqueModuleName('Housekeeping tasks', [{ name: 'Other', slug: 'housekeeping-tasks' }]),
    ).toBe('Housekeeping tasks (2)')
  })

  it('counts up past taken suffixes', () => {
    expect(
      uniqueModuleName('Rooms', [
        { name: 'Rooms', slug: 'rooms' },
        { name: 'Rooms (2)', slug: 'rooms-2' },
      ]),
    ).toBe('Rooms (3)')
  })
})
