import { NETWORK_ERROR_MESSAGE, isNetworkError, isPostgrestError } from '@/lib/postgrest-errors'

import { describeCustomValuesReason, parseCustomValuesError } from './custom-values-errors'
import { RECORD_CONFLICT_MESSAGE } from './record-conflict'

export const RECORD_FORBIDDEN_MESSAGE =
  'You are not allowed to change records in this workspace. Ask an owner to check your membership.'
export const RECORD_NOT_FOUND_MESSAGE = 'This record no longer exists or you cannot change it.'
export const RECORD_CHECK_MESSAGE =
  'Use a title of 1 to 200 characters and a status of at most 50 characters.'
export const RECORD_FIELD_ERROR_MESSAGE =
  'Some values need attention. Check the highlighted fields.'
export const RECORD_FIELDS_CHANGED_MESSAGE =
  'The fields of this module changed while you were editing. Review the highlighted field and save again.'
export const GENERIC_RECORD_ERROR_MESSAGE = 'The record could not be saved. Please try again.'

/** Thrown by the hooks when a write affected zero rows: RLS hid the record or it is gone. */
export class RecordNotFoundError extends Error {
  constructor() {
    super(RECORD_NOT_FOUND_MESSAGE)
    this.name = 'RecordNotFoundError'
  }
}

/** Friendly text for a failed record create, update or delete. */
export function getRecordErrorMessage(error: unknown): string {
  if (error instanceof RecordNotFoundError) return error.message
  if (isPostgrestError(error)) {
    switch (error.code) {
      case '42501': // insufficient_privilege (RLS)
        return RECORD_FORBIDDEN_MESSAGE
      case 'PT409': // update_record: saved by someone else since the form opened
        return RECORD_CONFLICT_MESSAGE
      case 'PT404': // update_record: the record is gone or hidden
      case 'PGRST116': // zero rows for .single()
      case '23503': // module gone or in another workspace
        return RECORD_NOT_FOUND_MESSAGE
      case '23514': {
        const parsed = parseCustomValuesError(error)
        return parsed ? describeCustomValuesReason(parsed.reason) : RECORD_CHECK_MESSAGE
      }
      default:
        return GENERIC_RECORD_ERROR_MESSAGE
    }
  }
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
  return GENERIC_RECORD_ERROR_MESSAGE
}

export interface RecordSaveErrorMapping {
  /** Form path (`custom_values.<key>`) and message, when the server named a field. */
  field?: { key: string; message: string }
  /** Form-level message (always set so the live region announces something). */
  formError: string
}

/**
 * Maps a save failure for the record form: a 23514 `custom_values.<key>:
 * <reason>` goes onto the field; everything else becomes a form-level error.
 * `knownKeys` are the fields the form currently renders; a key outside them
 * means the definitions changed under the user (for example a required field
 * was added), so the form also asks to review after refetching the fields.
 */
export function mapRecordSaveError(
  error: unknown,
  knownKeys: readonly string[],
): RecordSaveErrorMapping {
  const parsed = parseCustomValuesError(error)
  if (parsed?.key) {
    return {
      field: { key: parsed.key, message: describeCustomValuesReason(parsed.reason) },
      formError: knownKeys.includes(parsed.key)
        ? RECORD_FIELD_ERROR_MESSAGE
        : RECORD_FIELDS_CHANGED_MESSAGE,
    }
  }
  return { formError: getRecordErrorMessage(error) }
}
