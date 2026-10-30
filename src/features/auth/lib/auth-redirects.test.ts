import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {},
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'anon',
}))

import { buildSignInUrl, getLocalMailInboxUrl, getSafeRedirect } from './auth-redirects'

describe('getSafeRedirect', () => {
  it('accepts same-origin paths', () => {
    expect(getSafeRedirect('/settings/profile?tab=1')).toBe('/settings/profile?tab=1')
  })

  it.each([
    [null],
    [''],
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['settings'],
    ['/auth/sign-in'],
  ])('falls back to the dashboard for %j', (value) => {
    expect(getSafeRedirect(value)).toBe('/')
  })
})

describe('buildSignInUrl', () => {
  it('encodes the redirect target', () => {
    expect(buildSignInUrl('/settings/profile?tab=1')).toBe(
      '/auth/sign-in?redirectTo=%2Fsettings%2Fprofile%3Ftab%3D1',
    )
  })
})

describe('getLocalMailInboxUrl', () => {
  it('points at Mailpit for a local stack', () => {
    expect(getLocalMailInboxUrl()).toBe('http://127.0.0.1:54324')
  })
})
