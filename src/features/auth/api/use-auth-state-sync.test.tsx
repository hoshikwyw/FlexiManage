import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { createTestQueryClient } from '@/test/render'
import { createTestSession, createTestUser } from '@/test/supabase-mock'

import { authKeys } from './keys'
import { useAuthStateSync } from './use-auth-state-sync'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const onAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange)

type AuthCallback = Parameters<typeof supabase.auth.onAuthStateChange>[0]

const alice = createTestUser()
const bob = createTestUser({ id: '00000000-0000-0000-0000-00000000000b', email: 'bob@example.com' })

function setup() {
  const queryClient = createTestQueryClient()
  const unsubscribe = vi.fn()
  let callback: AuthCallback | undefined
  onAuthStateChange.mockImplementation((cb) => {
    callback = cb
    return { data: { subscription: { id: 'sub', callback: cb, unsubscribe } } }
  })

  const hook = renderHook(() => useAuthStateSync(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

  function fire(event: AuthChangeEvent, session: Session | null) {
    act(() => {
      callback?.(event, session)
    })
  }

  /** Data a signed-in user would have loaded. */
  function seedUserData() {
    queryClient.setQueryData(['profile', alice.id], { id: alice.id })
    queryClient.setQueryData(['workspaces', alice.id], [])
    queryClient.setQueryData(['members', 'ws-1'], [])
  }

  function userScopedQueryCount() {
    return queryClient
      .getQueryCache()
      .findAll({ predicate: (query) => query.queryKey[0] !== 'auth' }).length
  }

  return { queryClient, fire, seedUserData, userScopedQueryCount, unsubscribe, ...hook }
}

describe('useAuthStateSync', () => {
  beforeEach(() => {
    onAuthStateChange.mockReset()
  })

  it('subscribes once and mirrors every event into the session query', () => {
    const { queryClient, fire } = setup()
    expect(onAuthStateChange).toHaveBeenCalledTimes(1)

    const session = createTestSession(alice)
    fire('INITIAL_SESSION', session)
    expect(queryClient.getQueryData(authKeys.session)).toBe(session)

    fire('SIGNED_OUT', null)
    expect(queryClient.getQueryData(authKeys.session)).toBeNull()
  })

  it('removes every non-auth query on SIGNED_OUT and keeps the auth state', () => {
    const { queryClient, fire, seedUserData, userScopedQueryCount } = setup()
    fire('SIGNED_IN', createTestSession(alice))
    seedUserData()
    expect(userScopedQueryCount()).toBe(3)

    fire('SIGNED_OUT', null)

    expect(userScopedQueryCount()).toBe(0)
    expect(queryClient.getQueryCache().find({ queryKey: authKeys.session })).toBeDefined()
    expect(queryClient.getQueryData(['profile', alice.id])).toBeUndefined()
  })

  it('removes the previous user’s queries when a different user signs in', () => {
    const { fire, seedUserData, userScopedQueryCount } = setup()
    fire('SIGNED_IN', createTestSession(alice))
    seedUserData()

    fire('SIGNED_IN', createTestSession(bob))

    expect(userScopedQueryCount()).toBe(0)
  })

  it('keeps the queries when the same user refreshes a token', () => {
    const { fire, seedUserData, userScopedQueryCount } = setup()
    fire('SIGNED_IN', createTestSession(alice))
    seedUserData()

    fire('TOKEN_REFRESHED', createTestSession(alice))
    fire('USER_UPDATED', createTestSession(alice))

    expect(userScopedQueryCount()).toBe(3)
  })

  it('unsubscribes on unmount', () => {
    const { unmount, unsubscribe } = setup()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
