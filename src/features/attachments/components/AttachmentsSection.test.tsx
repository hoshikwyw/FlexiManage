import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'
import type { WorkspaceRole } from '@/types/database'

import { useAttachments } from '../api/use-attachments'
import { deleteAttachment, downloadAttachment } from '../api/attachment-writes'
import type { AttachmentItem } from '../types'
import { AttachmentsSection } from './AttachmentsSection'

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseMock } = await import('@/test/supabase-mock')
  return {
    supabase: createSupabaseMock(),
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon',
  }
})
vi.mock('../api/use-attachments', () => ({ useAttachments: vi.fn() }))
vi.mock('../api/attachment-writes', () => ({
  uploadAttachment: vi.fn(),
  downloadAttachment: vi.fn().mockResolvedValue(undefined),
  deleteAttachment: vi.fn().mockResolvedValue(undefined),
}))

const ALICE = 'user-alice'
const BOB = 'user-bob'

function attachment(overrides: Partial<AttachmentItem>): AttachmentItem {
  return {
    id: 'att-1',
    workspace_id: 'ws',
    record_id: 'rec',
    file_name: 'logo.png',
    content_type: 'image/png',
    size_bytes: 1536,
    storage_path: 'ws/rec/att-1-logo.png',
    uploaded_by: ALICE,
    created_at: '2026-11-04T09:00:00.000Z',
    uploader: { id: ALICE, email: 'alice@example.com', full_name: 'Alice Owner' },
    ...overrides,
  }
}

const LIST = [
  attachment({}),
  attachment({
    id: 'att-2',
    file_name: 'contract.pdf',
    content_type: 'application/pdf',
    size_bytes: 2_097_152,
    storage_path: 'ws/rec/att-2-contract.pdf',
    uploaded_by: BOB,
    uploader: { id: BOB, email: 'bob@example.com', full_name: null },
  }),
  attachment({ id: 'att-3', file_name: 'old.txt', uploaded_by: null, uploader: null }),
]

function mockAttachments(state: Partial<ReturnType<typeof useAttachments>>) {
  const refetch = vi.fn()
  vi.mocked(useAttachments).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
    refetch,
    ...state,
  } as unknown as ReturnType<typeof useAttachments>)
  return refetch
}

function renderSection(role: WorkspaceRole = 'member', userId = BOB) {
  return renderWithProviders(
    <AttachmentsSection workspaceId="ws" recordId="rec" currentUserId={userId} role={role} />,
  )
}

const rows = () =>
  within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem')

describe('AttachmentsSection', () => {
  beforeEach(() => {
    vi.mocked(deleteAttachment).mockClear()
    vi.mocked(downloadAttachment).mockClear()
  })

  it('shows a loading skeleton', () => {
    mockAttachments({ isPending: true })
    renderSection()
    expect(screen.getByLabelText('Loading attachments')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument()
  })

  it('shows an error with a retry button', async () => {
    const user = userEvent.setup()
    const refetch = mockAttachments({ isError: true })
    renderSection()
    expect(screen.getByRole('alert')).toHaveTextContent('Attachments could not be loaded.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the empty state, "0 of 10" and the upload button', () => {
    mockAttachments({ isSuccess: true, data: [] })
    renderSection()
    expect(screen.getByText('No files attached yet.')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('0 of 10')
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled()
  })

  it('lists name, size, uploader and the count', () => {
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection('member', BOB)
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('3 of 10')
    const [first, second, third] = rows()
    expect(first).toHaveTextContent('logo.png')
    expect(first).toHaveTextContent('1.5 KB · Uploaded by Alice Owner on')
    expect(second).toHaveTextContent('2 MB · Uploaded by you on')
    expect(third).toHaveTextContent('Uploaded by Someone on')
  })

  it('offers delete only on the member’s own files', () => {
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection('member', BOB)
    expect(screen.queryByRole('button', { name: 'Delete logo.png' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete contract.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete old.txt' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Download / })).toHaveLength(3)
  })

  it.each(['owner', 'admin'] as const)('offers delete on every file to an %s', (role) => {
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection(role, 'someone-else')
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(3)
  })

  it('downloads through the hook', async () => {
    const user = userEvent.setup()
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Download contract.pdf' }))
    await waitFor(() => expect(downloadAttachment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadAttachment).mock.calls[0]?.[0]).toMatchObject({ id: 'att-2' })
  })

  it('confirms before deleting and closes the dialog afterwards', async () => {
    const user = userEvent.setup()
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection('member', BOB)
    await user.click(screen.getByRole('button', { name: 'Delete contract.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete contract.pdf?')
    expect(deleteAttachment).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete file' }))
    await waitFor(() => expect(deleteAttachment).toHaveBeenCalledTimes(1))
    expect(vi.mocked(deleteAttachment).mock.calls[0]).toEqual(['ws', { id: 'att-2' }])
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open with the error when the server refuses', async () => {
    const user = userEvent.setup()
    const { AttachmentError, DELETE_FORBIDDEN_MESSAGE } = await import('../lib/storage-errors')
    vi.mocked(deleteAttachment).mockRejectedValueOnce(
      new AttachmentError('forbidden', DELETE_FORBIDDEN_MESSAGE),
    )
    mockAttachments({ isSuccess: true, data: LIST })
    renderSection('member', BOB)
    await user.click(screen.getByRole('button', { name: 'Delete contract.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete file' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(/uploader or an owner/),
    )
  })

  it('disables uploads at 10 attachments', () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      attachment({ id: `att-${i}`, file_name: `f${i}.png` }),
    )
    mockAttachments({ isSuccess: true, data: ten })
    renderSection()
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('10 of 10')
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
  })
})
