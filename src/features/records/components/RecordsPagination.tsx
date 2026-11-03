import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { describePageRange, lastPage } from '../lib/pagination'
import { PAGE_SIZES, type PageSize } from '../types'

interface RecordsPaginationProps {
  page: number
  pageSize: PageSize
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: PageSize) => void
}

/** Page size select, range indicator and previous/next. */
export function RecordsPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: RecordsPaginationProps) {
  const sizeId = useId()
  const last = lastPage(pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="text-muted-foreground">
          Rows per page
        </label>
        <NativeSelect
          id={sizeId}
          size="sm"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-center gap-2">
        <p aria-live="polite" className="text-muted-foreground tabular-nums">
          {describePageRange(page, pageSize, total)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
