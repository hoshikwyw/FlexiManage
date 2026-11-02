import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { SignInPage } from './SignInPage'
import { SignUpPage } from './SignUpPage'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const INVITE_SEARCH = '?redirectTo=%2Finvite%2Ftoken-123'

describe('auth page cross-links', () => {
  it('SignInPage keeps redirectTo on the "Create one" link', () => {
    renderWithProviders(<SignInPage />, { initialEntries: [`/auth/sign-in${INVITE_SEARCH}`] })

    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      `/auth/sign-up${INVITE_SEARCH}`,
    )
  })

  it('SignUpPage keeps redirectTo on the "Sign in" link', () => {
    renderWithProviders(<SignUpPage />, { initialEntries: [`/auth/sign-up${INVITE_SEARCH}`] })

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/auth/sign-in${INVITE_SEARCH}`,
    )
  })

  it('links have no query string when the page was opened without one', () => {
    renderWithProviders(<SignInPage />, { initialEntries: ['/auth/sign-in'] })

    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/auth/sign-up',
    )
  })
})
