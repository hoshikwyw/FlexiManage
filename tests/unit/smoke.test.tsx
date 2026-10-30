import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

describe('scaffold smoke test', () => {
  it('merges class names with cn()', () => {
    const isHidden: boolean = false
    expect(cn('p-2', isHidden && 'hidden', 'p-4')).toBe('p-4')
  })

  it('renders the shadcn Button', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })
})
