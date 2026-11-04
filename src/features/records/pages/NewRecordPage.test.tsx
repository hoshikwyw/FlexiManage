import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { useFieldDefinitions } from '@/features/modules/api/use-field-definitions'
import { useModule } from '@/features/modules/api/use-module'
import { createTestField, createTestModule, TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { renderWithWorkspace } from '@/test/workspace-context'

import { useCreateRecord } from '../api/use-create-record'
import { NewRecordPage } from './NewRecordPage'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})
vi.mock('@/features/modules/api/use-module', () => ({ useModule: vi.fn() }))
vi.mock('@/features/modules/api/use-field-definitions', () => ({ useFieldDefinitions: vi.fn() }))
vi.mock('../api/use-create-record', () => ({ useCreateRecord: vi.fn() }))

const NEW_ID = '00000000-0000-0000-0000-0000000e0099'
const BASE = `/w/${TEST_WORKSPACE_ID}/modules/${TEST_MODULE_ID}`

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

describe('NewRecordPage', () => {
  it('opens the new record’s page after creating it, where files can be attached', async () => {
    const user = userEvent.setup()
    vi.mocked(useModule).mockReturnValue({
      data: createTestModule(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useModule>)
    vi.mocked(useFieldDefinitions).mockReturnValue({
      data: [createTestField()],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useFieldDefinitions>)
    const mutateAsync = vi.fn().mockResolvedValue({ id: NEW_ID, title: 'Globex' })
    vi.mocked(useCreateRecord).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateRecord>)

    renderWithWorkspace(
      <Routes>
        <Route path="/w/:workspaceId/modules/:moduleId/records/new" element={<NewRecordPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>,
      { initialEntries: [`${BASE}/records/new`] },
    )

    // paste, not type: one input event instead of six keeps this test fast under load.
    await user.click(screen.getByLabelText('Title'))
    await user.paste('Globex')
    await user.click(screen.getByRole('button', { name: 'Create record' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/records/${NEW_ID}`),
    )
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: 'Globex' }))
  })
})
