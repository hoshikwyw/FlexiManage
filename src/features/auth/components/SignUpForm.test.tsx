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

/**
 * Fill the four fields the way a password manager or a paste does: focus the field, then one
 * input event per field. `user.type` would dispatch the full key sequence (and re-render the
 * whole form) for each of the ~50 characters; under a loaded full run that alone took 7 to 11 s
 * of the 15 s test timeout and made the first test of this file flaky. None of these tests is
 * about per-keystroke behaviour (the form validates on submit).
 */
async function fillField(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.click(screen.getByLabelText(label))
  await user.paste(value)
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { fullName: string; email: string; password: string; confirmPassword: string },
) {
  await fillField(user, 'Full name', values.fullName)
  await fillField(user, 'Email', values.email)
  await fillField(user, 'Password', values.password)
  await fillField(user, 'Confirm password', values.confirmPassword)
  // The values must have arrived (one paste each), or a mismatch could come from a lost input.
  expect(screen.getByLabelText('Full name')).toHaveValue(values.fullName)
  expect(screen.getByLabelText('Email')).toHaveValue(values.email)
  expect(screen.getByLabelText('Password')).toHaveValue(values.password)
  expect(screen.getByLabelText('Confirm password')).toHaveValue(values.confirmPassword)
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
