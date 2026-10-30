import { AuthApiError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'
import { createTestSession } from '@/test/supabase-mock'

import { SignInForm } from './SignInForm'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const signInWithPassword = vi.mocked(supabase.auth.signInWithPassword)

describe('SignInForm', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
  })

  it('shows validation errors and does not call Supabase when fields are empty', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignInForm />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignInForm />)

    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('submits normalised credentials and reports success', async () => {
    const user = userEvent.setup()
    const session = createTestSession()
    signInWithPassword.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    })
    const onSuccess = vi.fn()
    const { queryClient } = renderWithProviders(<SignInForm onSuccess={onSuccess} />)

    await user.type(screen.getByLabelText('Email'), '  Alice@Example.com ')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'password123',
    })
    expect(queryClient.getQueryData(['auth', 'session'])).toBe(session)
  })

  it('announces a friendly message when credentials are wrong', async () => {
    const user = userEvent.setup()
    signInWithPassword.mockResolvedValue({
      data: { session: null, user: null, weakPassword: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    })
    renderWithProviders(<SignInForm />)

    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByText('Incorrect email or password.')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})
