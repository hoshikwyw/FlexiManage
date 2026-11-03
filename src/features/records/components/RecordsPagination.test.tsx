import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { describePageRange, lastPage } from '../lib/pagination'
import { RecordsPagination } from './RecordsPagination'

describe('describePageRange', () => {
  it('formats the visible range and clamps the last page', () => {
    expect(describePageRange(1, 25, 312)).toBe('1–25 of 312')
    expect(describePageRange(13, 25, 312)).toBe('301–312 of 312')
    expect(describePageRange(2, 25, 33)).toBe('26–33 of 33')
    expect(describePageRange(1, 25, 0)).toBe('0 records')
    expect(lastPage(25, 0)).toBe(1)
    expect(lastPage(25, 50)).toBe(2)
    expect(lastPage(25, 51)).toBe(3)
  })
})

describe('RecordsPagination', () => {
  function renderPagination(page: number, total: number) {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    renderWithProviders(
      <RecordsPagination
        page={page}
        pageSize={25}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    )
    return { onPageChange, onPageSizeChange }
  }

  it('disables previous on the first page and moves forward', async () => {
    const user = userEvent.setup()
    const { onPageChange } = renderPagination(1, 33)
    expect(screen.getByText('1–25 of 33')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('disables next on the last page and moves back', async () => {
    const user = userEvent.setup()
    const { onPageChange } = renderPagination(2, 33)
    expect(screen.getByText('26–33 of 33')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('offers 25, 50 and 100 rows per page', async () => {
    const user = userEvent.setup()
    const { onPageSizeChange } = renderPagination(1, 10)
    const select = screen.getByLabelText('Rows per page')
    expect(
      Array.from(select.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['25', '50', '100'])
    await user.selectOptions(select, '100')
    expect(onPageSizeChange).toHaveBeenCalledWith(100)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
})
