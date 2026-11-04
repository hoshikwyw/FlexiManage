import { describe, expect, it } from 'vitest'

import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [-5, '0 B'],
    [Number.NaN, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [102_400, '100 KB'],
    [1_048_576, '1 MB'],
    [12_897_484, '12.3 MB'],
    [10_485_760, '10 MB'],
    [1_073_741_824, '1 GB'],
  ])('%d bytes -> %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('moves to the next unit instead of showing 1024 KB', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB')
  })
})
