import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'
import type { WorkspaceRole } from '@/types/database'

import { exportRecords } from '../api/use-export-records'
import { ExportError } from '../lib/export-records'
import { ExportCsvButton } from './ExportCsvButton'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})
vi.mock('../api/use-export-records', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const exportRecords = vi.fn()
  return {
    exportRecords,
    useExportRecords: () => useMutation({ mutationFn: exportRecords }),
  }
})

const QUERY = { search: 'acme', filters: [] }

function renderButton(role: WorkspaceRole | null, disabled = false) {
  return renderWithProviders(
    <>
      <ExportCsvButton
        workspaceId="ws"
        moduleId="mod"
        moduleSlug="clients"
        role={role}
        query={QUERY}
        disabled={disabled}
      />
      <Toaster />
    </>,
  )
}

describe('ExportCsvButton', () => {
  it.each(['owner', 'admin'] as const)('is shown to an %s', (role) => {
    renderButton(role)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })

  it.each(['member', null] as const)('is hidden for role %s', (role) => {
    renderButton(role)
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
  })

  it('is disabled when there is nothing to export', () => {
    renderButton('owner', true)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('exports the current query, shows the pending state and a success toast', async () => {
    const user = userEvent.setup()
    let finish!: (value: { fileName: string }) => void
    vi.mocked(exportRecords).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderButton('admin')
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('button', { name: 'Exporting...' })).toBeDisabled()
    expect(vi.mocked(exportRecords).mock.calls[0]?.[0]).toEqual({
      workspaceId: 'ws',
      moduleId: 'mod',
      moduleSlug: 'clients',
      query: QUERY,
    })
    finish({ fileName: 'clients-2026-11-04.csv' })
    expect(await screen.findByText('Export downloaded')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled())
  })

  it('shows the mapped error in a toast', async () => {
    const user = userEvent.setup()
    vi.mocked(exportRecords).mockRejectedValueOnce(new ExportError('export_too_large', 413))
    renderButton('owner')
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(
      await screen.findByText(
        'More than 50,000 records match. Narrow the search or filters and try again.',
      ),
    ).toBeInTheDocument()
  })
})
