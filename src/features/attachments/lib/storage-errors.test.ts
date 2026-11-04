import { StorageApiError, StorageUnknownError } from '@supabase/storage-js'
import { describe, expect, it } from 'vitest'

import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'

import {
  AttachmentError,
  getAttachmentErrorMessage,
  mapAttachmentRowError,
  mapStorageError,
} from './storage-errors'

/** What storage-js builds from a Storage answer: HTTP status plus the body's `statusCode`. */
const apiError = (status: number, statusCode: string, message = 'denied') =>
  new StorageApiError(message, status, statusCode)

const pg = (code: string, message = '', details: string | null = null) => ({
  code,
  message,
  details,
  hint: null,
})

describe('mapStorageError', () => {
  it.each([
    ['403', 'forbidden'],
    ['404', 'not_found'],
    ['409', 'already_exists'],
    ['413', 'too_large'],
    ['415', 'type_not_allowed'],
  ] as const)('reads the body status %s of an HTTP 400 answer as %s', (statusCode, code) => {
    expect(mapStorageError(apiError(400, statusCode)).code).toBe(code)
  })

  it('falls back to the HTTP status when the body has no usable statusCode', () => {
    expect(mapStorageError(apiError(403, 'Unauthorized')).code).toBe('forbidden')
    expect(mapStorageError(apiError(413, '')).code).toBe('too_large')
  })

  it('maps an unknown status to unknown', () => {
    expect(mapStorageError(apiError(400, '400')).code).toBe('unknown')
    expect(mapStorageError(apiError(500, '500')).code).toBe('unknown')
  })

  it('maps a fetch that never reached Storage to network', () => {
    const unknown = new StorageUnknownError('Failed to fetch', new TypeError('Failed to fetch'))
    const mapped = mapStorageError(unknown)
    expect(mapped.code).toBe('network')
    expect(mapped.message).toBe(NETWORK_ERROR_MESSAGE)
    expect(mapStorageError(new TypeError('NetworkError when attempting to fetch')).code).toBe(
      'network',
    )
  })

  it('passes AttachmentError through and maps anything else to unknown', () => {
    const own = new AttachmentError('too_many')
    expect(mapStorageError(own)).toBe(own)
    expect(mapStorageError(new Error('boom')).code).toBe('unknown')
    expect(mapStorageError('nope').code).toBe('unknown')
  })
})

describe('mapAttachmentRowError', () => {
  it('maps the migration 005 rule violations', () => {
    expect(mapAttachmentRowError(pg('42501', 'new row violates row-level security')).code).toBe(
      'forbidden',
    )
    expect(mapAttachmentRowError(pg('23503', 'attachments_record_workspace_fkey')).code).toBe(
      'not_found',
    )
    expect(
      mapAttachmentRowError(pg('23514', 'attachments: at most 10 files per record')).code,
    ).toBe('too_many')
    expect(
      mapAttachmentRowError(
        pg('23514', 'new row violates check constraint "attachments_size_bytes_check"'),
      ).code,
    ).toBe('too_large')
    expect(
      mapAttachmentRowError(
        pg('23514', 'new row violates check constraint "attachments_content_type_check"'),
      ).code,
    ).toBe('type_not_allowed')
    const name = mapAttachmentRowError(
      pg('23514', 'new row violates check constraint "attachments_file_name_check"'),
    )
    expect(name.code).toBe('unknown')
    expect(name.message).toMatch(/file name/)
  })

  it('maps network failures and unknown codes', () => {
    expect(mapAttachmentRowError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(mapAttachmentRowError(pg('XX000')).code).toBe('unknown')
  })
})

describe('getAttachmentErrorMessage', () => {
  it('uses the AttachmentError message or maps the error first', () => {
    expect(getAttachmentErrorMessage(new AttachmentError('too_large'))).toBe('Larger than 10 MB.')
    expect(getAttachmentErrorMessage(apiError(400, '415'))).toMatch(/not allowed/)
    expect(getAttachmentErrorMessage(apiError(400, '404'))).toMatch(/no longer exists/)
  })
})
