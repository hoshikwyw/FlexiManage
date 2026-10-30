import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'
import { createTestUser } from '@/test/supabase-mock'

import { SignUpForm } from './SignUpForm'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const signUp = vi.mocked(supabase.auth.signUp)

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { fullName: string; email: string; password: string; confirmPassword: string },
) {
  await user.type(screen.getByLabelText('Full name'), values.fullName)
  await user.type(screen.getByLabelText('Email'), values.email)
  await user.type(screen.getByLabelText('Password'), values.password)
  await user.type(screen.getByLabelText('Confirm password'), values.confirmPassword)
}

describe('SignUpForm', () => {
  beforeEach(() => {
    signUp.mockReset()
  })

  it('flags a password mismatch on the confirm field and does not submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignUpForm />)

    await fillForm(user, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'password123',
      confirmPassword: 'password124',
    })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('enforces the minimum password length and a full name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignUpForm />)

    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Full name is required')).toBeInTheDocument()
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('passes full_name as user metadata and reports whether confirmation is needed', async () => {
    const user = userEvent.setup()
    const createdUser = createTestUser({
      email: 'ada@example.com',
      identities: [
        {
          id: 'x',
          identity_id: 'x',
          user_id: 'x',
          provider: 'email',
          identity_data: {},
          created_at: '',
          last_sign_in_at: '',
          updated_at: '',
        },
      ],
    })
    signUp.mockResolvedValue({ data: { user: createdUser, session: null }, error: null })
    const onSuccess = vi.fn()
    renderWithProviders(<SignUpForm onSuccess={onSuccess} />)

    await fillForm(user, {
      fullName: '  Ada Lovelace ',
      email: 'Ada@Example.com',
      password: 'password123',
      confirmPassword: 'password123',
    })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'password123',
      options: {
        data: { full_name: 'Ada Lovelace' },
        emailRedirectTo: 'http://localhost:3000/auth/callback',
      },
    })
    expect(onSuccess.mock.calls[0]?.[0]).toMatchObject({ needsEmailConfirmation: true })
  })

  it('treats the obfuscated "already registered" response as an error', async () => {
    const user = userEvent.setup()
    signUp.mockResolvedValue({
      data: { user: createTestUser({ identities: [] }), session: null },
      error: null,
    })
    renderWithProviders(<SignUpForm />)

    await fillForm(user, {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    })
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(
      await screen.findByText('An account with this email already exists. Sign in instead.'),
    ).toBeInTheDocument()
  })
})
