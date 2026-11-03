import { describe, expect, it } from 'vitest'

import { createModuleSchema, updateModuleSchema } from './module'

const valid = { name: 'Rooms', slug: 'rooms', description: '', templateId: 'blank' }

describe('createModuleSchema', () => {
  it('accepts a trimmed name, a slug, an optional description and a known template', () => {
    const parsed = createModuleSchema.parse({ ...valid, name: '  Rooms  ' })
    expect(parsed.name).toBe('Rooms')
    expect(
      createModuleSchema.safeParse({ ...valid, templateId: 'housekeeping-tasks' }).success,
    ).toBe(true)
  })

  it('requires a name of 1 to 100 characters', () => {
    expect(createModuleSchema.safeParse({ ...valid, name: '   ' }).error?.issues[0]?.message).toBe(
      'Module name is required',
    )
    expect(
      createModuleSchema.safeParse({ ...valid, name: 'a'.repeat(101) }).error?.issues[0]?.message,
    ).toMatch(/100 characters or fewer/)
  })

  it('validates the slug shape and the description length', () => {
    expect(createModuleSchema.safeParse({ ...valid, slug: 'Bad Slug' }).success).toBe(false)
    expect(createModuleSchema.safeParse({ ...valid, slug: '-rooms' }).success).toBe(false)
    expect(
      createModuleSchema.safeParse({ ...valid, description: 'x'.repeat(501) }).error?.issues[0]
        ?.message,
    ).toMatch(/500 characters or fewer/)
  })

  it('rejects an unknown template id', () => {
    expect(
      createModuleSchema.safeParse({ ...valid, templateId: 'nope' }).error?.issues[0]?.message,
    ).toBe('Choose a template')
  })
})

describe('updateModuleSchema', () => {
  it('accepts an empty icon or one of the curated names only', () => {
    const base = { name: 'Rooms', slug: 'rooms', description: 'Per-room tasks' }
    expect(updateModuleSchema.safeParse({ ...base, icon: '' }).success).toBe(true)
    expect(updateModuleSchema.safeParse({ ...base, icon: 'bed-double' }).success).toBe(true)
    expect(updateModuleSchema.safeParse({ ...base, icon: 'unicorn' }).success).toBe(false)
  })
})
