import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'
import { createTestSession } from '@/test/supabase-mock'

import { ProtectedRoute } from './ProtectedRoute'
import { PublicOnlyRoute } from './PublicOnlyRoute'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const getSession = vi.mocked(supabase.auth.getSession)

function LocationProbe({ label }: { label: string }) {
  const location = useLocation()
  return (
    <p>
      {label} at {location.pathname}
      {location.search}
    </p>
  )
}

function App() {
  return (
    <Routes>
      <Route
        path="/auth/sign-in"
        element={
          <PublicOnlyRoute>
            <LocationProbe label="Sign in page" />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/settings/profile"
        element={
          <ProtectedRoute>
            <LocationProbe label="Secret page" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <LocationProbe label="Dashboard" />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    getSession.mockReset()
  })

  it('shows a spinner until the session is known, then redirects signed-out users', async () => {
    let resolveSession!: (value: { data: { session: null }; error: null }) => void
    getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    renderWithProviders(<App />, { initialEntries: ['/settings/profile?tab=security'] })

    expect(screen.getByRole('status', { name: 'Checking your session' })).toBeInTheDocument()
    expect(screen.queryByText(/Sign in page/)).not.toBeInTheDocument()

    resolveSession({ data: { session: null }, error: null })

    expect(
      await screen.findByText(
        'Sign in page at /auth/sign-in?redirectTo=%2Fsettings%2Fprofile%3Ftab%3Dsecurity',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Secret page/)).not.toBeInTheDocument()
  })

  it('renders the protected children when a session exists', async () => {
    getSession.mockResolvedValue({ data: { session: createTestSession() }, error: null })
    renderWithProviders(<App />, { initialEntries: ['/settings/profile'] })

    expect(await screen.findByText('Secret page at /settings/profile')).toBeInTheDocument()
  })
})

describe('PublicOnlyRoute', () => {
  beforeEach(() => {
    getSession.mockReset()
  })

  it('sends signed-in users to the validated redirect target', async () => {
    getSession.mockResolvedValue({ data: { session: createTestSession() }, error: null })
    renderWithProviders(<App />, {
      initialEntries: ['/auth/sign-in?redirectTo=%2Fsettings%2Fprofile'],
    })

    expect(await screen.findByText('Secret page at /settings/profile')).toBeInTheDocument()
  })

  it('ignores unsafe redirect targets', async () => {
    getSession.mockResolvedValue({ data: { session: createTestSession() }, error: null })
    renderWithProviders(<App />, {
      initialEntries: ['/auth/sign-in?redirectTo=https%3A%2F%2Fevil.example'],
    })

    expect(await screen.findByText('Dashboard at /')).toBeInTheDocument()
  })

  it('renders the auth page for signed-out users', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderWithProviders(<App />, { initialEntries: ['/auth/sign-in'] })

    expect(await screen.findByText('Sign in page at /auth/sign-in')).toBeInTheDocument()
  })
})
