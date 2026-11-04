import type { FunctionFailure } from '@/lib/function-errors'
import { NETWORK_ERROR_MESSAGE, isNetworkError, isPostgrestError } from '@/lib/postgrest-errors'

import { describeAttachmentRuleError, type AttachmentRuleError } from './attachment-rules'

/**
 * Normalised failure of an attachment action. The hooks throw this so the
 * components switch on `code`, never on Storage or PostgREST message text.
 */
export type AttachmentErrorCode =
  | AttachmentRuleError
  | 'forbidden'
  | 'not_found'
  | 'already_exists'
  | 'unauthorized'
  | 'network'
  | 'unknown'

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode

  constructor(code: AttachmentErrorCode, message?: string) {
    super(message ?? describeAttachmentError(code))
    this.name = 'AttachmentError'
    this.code = code
  }
}

/** The fields storage-js puts on a `StorageApiError` / `StorageUnknownError`. */
interface StorageErrorLike {
  __isStorageError: true
  status?: number
  statusCode?: string | number
  originalError?: unknown
  message: string
}

function isStorageErrorLike(error: unknown): error is StorageErrorLike {
  return typeof error === 'object' && error !== null && '__isStorageError' in error
}

const STORAGE_STATUS_TO_CODE: Record<number, AttachmentErrorCode> = {
  401: 'forbidden',
  403: 'forbidden',
  404: 'not_found',
  409: 'already_exists',
  413: 'too_large',
  415: 'type_not_allowed',
}

/**
 * Maps a Supabase Storage failure. Storage answers policy denials with HTTP
 * 400 and the logical status in the body (`{ statusCode: "403", error }`,
 * docs/architecture.md "Storage policies"); storage-js copies the body's
 * `statusCode` onto the error, so that wins over the HTTP `status`. A fetch
 * that never reached the server is a `StorageUnknownError` wrapping a
 * TypeError.
 */
export function mapStorageError(error: unknown): AttachmentError {
  if (error instanceof AttachmentError) return error
  if (isStorageErrorLike(error)) {
    if (error.originalError !== undefined && isNetworkError(error.originalError)) {
      return new AttachmentError('network')
    }
    const bodyStatus = Number(error.statusCode)
    const code =
      (Number.isFinite(bodyStatus) ? STORAGE_STATUS_TO_CODE[bodyStatus] : undefined) ??
      (typeof error.status === 'number' ? STORAGE_STATUS_TO_CODE[error.status] : undefined) ??
      'unknown'
    return new AttachmentError(code)
  }
  if (isNetworkError(error)) return new AttachmentError('network')
  return new AttachmentError('unknown')
}

/**
 * Maps a failed `attachments` row insert or delete (PostgREST). The server
 * rules of migration 005 arrive as 23514 (name, type, size, cap), 23503
 * (record gone or in another workspace) and 42501 (not a member).
 */
export function mapAttachmentRowError(error: unknown): AttachmentError {
  if (error instanceof AttachmentError) return error
  if (isPostgrestError(error)) {
    switch (error.code) {
      case '42501':
        return new AttachmentError('forbidden')
      case '23503':
      case 'PGRST116':
        return new AttachmentError('not_found')
      case '23514': {
        const text = `${error.message} ${error.details ?? ''}`
        if (/at most 10 files/i.test(text)) return new AttachmentError('too_many')
        if (/size_bytes/i.test(text)) return new AttachmentError('too_large')
        if (/content_type/i.test(text)) return new AttachmentError('type_not_allowed')
        return new AttachmentError('unknown', 'The file name or file was rejected by the server.')
      }
      default:
        return new AttachmentError('unknown')
    }
  }
  if (isNetworkError(error)) return new AttachmentError('network')
  return new AttachmentError('unknown')
}

const FUNCTION_CODE_TO_CODE: Record<string, AttachmentErrorCode> = {
  unauthorized: 'unauthorized',
  not_found: 'not_found',
  forbidden: 'forbidden',
  validation_error: 'unknown',
  internal: 'unknown',
}

const FUNCTION_STATUS_TO_CODE: Record<number, AttachmentErrorCode> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
}

/**
 * Maps a failed `attachment-url` call (`readFunctionError` output): the
 * envelope's `error.code` (401 unauthorized, 400 validation_error, 404
 * not_found, 500 internal), else the HTTP status, else network/unknown.
 * `not_found` also covers an attachment of another workspace: the function
 * does not reveal which.
 */
export function mapAttachmentFunctionError(failure: FunctionFailure): AttachmentError {
  if (failure.network) return new AttachmentError('network')
  const code =
    (failure.code !== null ? FUNCTION_CODE_TO_CODE[failure.code] : undefined) ??
    (failure.status !== null ? FUNCTION_STATUS_TO_CODE[failure.status] : undefined) ??
    'unknown'
  return new AttachmentError(code)
}

/** User-facing text for an attachment error code. */
export function describeAttachmentError(code: AttachmentErrorCode): string {
  switch (code) {
    case 'too_large':
    case 'empty':
    case 'type_not_allowed':
    case 'too_many':
      return describeAttachmentRuleError(code)
    case 'forbidden':
      return 'You are not allowed to change the files of this record.'
    case 'not_found':
      return 'This file or record no longer exists.'
    case 'already_exists':
      return 'A file with this name was already uploaded. Refresh the page and try again.'
    case 'unauthorized':
      return 'Your session has expired. Sign in again and retry.'
    case 'network':
      return NETWORK_ERROR_MESSAGE
    case 'unknown':
      return 'Something went wrong with the file. Please try again.'
  }
}

export const DELETE_FORBIDDEN_MESSAGE =
  'Only the uploader or an owner or admin can remove this file, or it was already removed.'

/** Message for any rejection from the attachment hooks. */
export function getAttachmentErrorMessage(error: unknown): string {
  if (error instanceof AttachmentError) return error.message
  return mapStorageError(error).message
}
