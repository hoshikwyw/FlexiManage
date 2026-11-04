import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_BYTES } from '../lib/attachment-rules'
import { AttachmentDropzone } from './AttachmentDropzone'

function sizedFile(name: string, size: number, type: string): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const input = () => screen.getByTestId('attachment-input') as HTMLInputElement

describe('AttachmentDropzone', () => {
  it('offers a keyboard-reachable button and an input restricted to the allow-list', async () => {
    const user = userEvent.setup()
    render(<AttachmentDropzone existingCount={0} onFiles={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Choose files' })
    await user.tab()
    expect(button).toHaveFocus()
    expect(input()).toHaveAttribute('accept', ACCEPT_ATTRIBUTE)
    expect(input()).toHaveAttribute('multiple')
  })

  it('rejects a 12 MB file and an exe inline and passes only the valid file on', async () => {
    const onFiles = vi.fn()
    render(<AttachmentDropzone existingCount={0} onFiles={onFiles} />)
    const big = sizedFile('scan.pdf', 12 * 1024 * 1024, 'application/pdf')
    const exe = sizedFile('setup.exe', 1000, 'application/x-msdownload')
    const ok = sizedFile('logo.png', 2000, 'image/png')
    // userEvent.upload would filter by `accept`; the change event mimics drag-and-drop input.
    fireEvent.change(input(), { target: { files: [big, exe, ok] } })

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles).toHaveBeenCalledWith([ok])
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('scan.pdf: Larger than 10 MB.')
    expect(alert).toHaveTextContent('setup.exe: This file type is not allowed.')
    expect(alert).not.toHaveTextContent('logo.png')
  })

  it('does not call onFiles when every file is rejected', () => {
    const onFiles = vi.fn()
    render(<AttachmentDropzone existingCount={0} onFiles={onFiles} />)
    fireEvent.change(input(), {
      target: { files: [sizedFile('a.png', MAX_ATTACHMENT_BYTES + 1, 'image/png')] },
    })
    expect(onFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('a.png: Larger than 10 MB.')
  })

  it('accepts dropped files and stops at the per-record cap within one batch', () => {
    const onFiles = vi.fn()
    render(<AttachmentDropzone existingCount={8} onFiles={onFiles} />)
    const files = ['1.png', '2.png', '3.png'].map((name) => sizedFile(name, 10, 'image/png'))
    fireEvent.drop(screen.getByTestId('attachment-dropzone'), { dataTransfer: { files } })
    expect(onFiles).toHaveBeenCalledWith(files.slice(0, 2))
    expect(screen.getByRole('alert')).toHaveTextContent('3.png: A record can have at most 10')
  })

  it('is disabled at 10 attachments and ignores drops', () => {
    const onFiles = vi.fn()
    render(<AttachmentDropzone existingCount={10} onFiles={onFiles} />)
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
    expect(input()).toBeDisabled()
    expect(screen.getByText(/maximum of 10 attachments/)).toBeInTheDocument()
    fireEvent.drop(screen.getByTestId('attachment-dropzone'), {
      dataTransfer: { files: [sizedFile('a.png', 10, 'image/png')] },
    })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('is disabled while a batch is uploading', () => {
    render(<AttachmentDropzone existingCount={1} busy onFiles={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Uploading...' })).toBeDisabled()
  })
})
