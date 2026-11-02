import { describe, expect, it } from 'vitest'

import { getDisplayName, getInitials } from './display-name'

describe('getDisplayName', () => {
  it('prefers the trimmed full name, then the email, then the fallback', () => {
    expect(getDisplayName({ full_name: '  Ada Lovelace ', email: 'ada@x.io' })).toBe('Ada Lovelace')
    expect(getDisplayName({ full_name: '   ', email: 'ada@x.io' })).toBe('ada@x.io')
    expect(getDisplayName(null, 'fallback@x.io')).toBe('fallback@x.io')
    expect(getDisplayName(undefined)).toBe('Account')
  })
})

describe('getInitials', () => {
  it('takes the first letter of up to two words', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL')
    expect(getInitials('Ada Byron King Lovelace')).toBe('AB')
    expect(getInitials('ada')).toBe('A')
  })

  it('uses only the local part of an email address', () => {
    expect(getInitials('ada@x.io')).toBe('A')
    expect(getInitials('ada.lovelace@example.com')).toBe('AL')
    expect(getInitials('ada_lovelace-king@example.com')).toBe('AL')
  })

  it('falls back to a question mark when nothing is usable', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('@example.com')).toBe('?')
  })
})
