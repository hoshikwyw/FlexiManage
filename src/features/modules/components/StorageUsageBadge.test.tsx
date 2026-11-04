import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { renderWithProviders } from '@/test/render'

import { StorageUsageBadge } from './StorageUsageBadge'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

describe('StorageUsageBadge', () => {
  it('shows storage_bytes from workspace_usage as "12.3 MB used"', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ modules: 1, records: 3, members: 2, attachments: 2, storage_bytes: 12_897_484 }],
      error: null,
    } as never)
    renderWithProviders(<StorageUsageBadge workspaceId="ws" />)
    expect(await screen.findByText('12.3 MB used')).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('workspace_usage', { p_workspace_id: 'ws' })
  })

  it('shows "0 B used" when the function returns no row', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never)
    renderWithProviders(<StorageUsageBadge workspaceId="ws" />)
    expect(await screen.findByText('0 B used')).toBeInTheDocument()
  })
})
