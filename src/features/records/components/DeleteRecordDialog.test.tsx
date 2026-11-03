import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { supabase } from '@/lib/supabase'
import { TEST_MODULE_ID, TEST_WORKSPACE_ID } from '@/test/fields'
import { createQueryBuilderMock } from '@/test/query-builder-mock'
import { renderWithProviders } from '@/test/render'

import { DeleteRecordDialog } from './DeleteRecordDialog'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})

const from = vi.mocked(supabase.from)
const RECORD = { id: '00000000-0000-0000-0000-0000000e0001', title: 'Acme Ltd' }

function renderDialog() {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  renderWithProviders(
    <DeleteRecordDialog
      workspaceId={TEST_WORKSPACE_ID}
      moduleId={TEST_MODULE_ID}
      record={RECORD}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  return { onClose, onDeleted }
}

describe('DeleteRecordDialog', () => {
  beforeEach(() => from.mockReset())

  it('deletes the record scoped by workspace and module and reports success', async () => {
    const user = userEvent.setup()
    const builder = createQueryBuilderMock({ data: [{ id: RECORD.id }], error: null })
    from.mockReturnValue(builder as never)
    const { onDeleted } = renderDialog()

    expect(screen.getByText('Delete Acme Ltd?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(builder.callsOf('delete')).toHaveLength(1)
    expect(builder.callsOf('eq')).toEqual([
      ['workspace_id', TEST_WORKSPACE_ID],
      ['module_id', TEST_MODULE_ID],
      ['id', RECORD.id],
    ])
    expect(builder.callsOf('select')).toEqual([['id']])
  })

  it('treats zero deleted rows as not found and keeps the dialog open', async () => {
    const user = userEvent.setup()
    from.mockReturnValue(createQueryBuilderMock({ data: [], error: null }) as never)
    const { onDeleted } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('closes on Cancel without deleting', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
})
