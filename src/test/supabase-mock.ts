import type { Session, User } from '@supabase/supabase-js'
import { vi } from 'vitest'

/**
 * Minimal stand-in for `supabase` from `@/lib/supabase`. Use it from a
 * `vi.mock('@/lib/supabase', ...)` factory; tests then adjust the behaviour of
 * the individual `vi.fn()`s through `vi.mocked(supabase.auth.xxx)`.
 */
export function createSupabaseMock() {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      updateUser: vi.fn(),
      resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
      exchangeCodeForSession: vi.fn(),
    },
    from: vi.fn(),
  }
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>

export function createTestUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-0000-0000-00000000000a',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'alice@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Alice Example' },
    created_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

export function createTestSession(user: User = createTestUser()): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  }
}
