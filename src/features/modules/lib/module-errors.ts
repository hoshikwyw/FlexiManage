import { NETWORK_ERROR_MESSAGE, isNetworkError, isPostgrestError } from '@/lib/postgrest-errors'

export const MODULE_SLUG_TAKEN_MESSAGE = 'A module with this slug already exists in this workspace.'
export const FIELD_KEY_TAKEN_MESSAGE = 'A field with this key already exists in this module.'
export const OPTIONS_INVALID_MESSAGE =
  'Select fields need 1 to 100 options with distinct, non-empty values; other field types have no options.'
export const SETTINGS_INVALID_MESSAGE =
  'Currency must be a three-letter ISO code and precision a whole number from 0 to 6.'
export const KEY_IMMUTABLE_MESSAGE =
  'The key of a field cannot be changed. Delete the field and create a new one instead.'
export const TYPE_LOCKED_MESSAGE =
  'The type of a field cannot be changed while records hold a value for it. Delete the field and create a new one instead.'
export const MODULE_FORBIDDEN_MESSAGE =
  'You are not allowed to change modules in this workspace. Ask an owner or admin.'
export const MODULE_NOT_FOUND_MESSAGE = 'This module no longer exists or you cannot change it.'
export const FIELD_NOT_FOUND_MESSAGE = 'This field no longer exists or you cannot change it.'
export const MODULE_CHECK_MESSAGE =
  'Use 1 to 100 characters for names and labels, a lowercase slug, and a key of lowercase letters, digits and underscores.'
export const FIELD_CAP_MESSAGE = 'This module has reached the maximum number of fields.'
export const GENERIC_MODULE_ERROR_MESSAGE = 'The change could not be saved. Please try again.'

/** Thrown by the hooks when a write affected zero rows: RLS hid the row or it is gone. */
export class ModuleNotFoundError extends Error {
  constructor(message = MODULE_NOT_FOUND_MESSAGE) {
    super(message)
    this.name = 'ModuleNotFoundError'
  }
}

export class FieldNotFoundError extends ModuleNotFoundError {
  constructor() {
    super(FIELD_NOT_FOUND_MESSAGE)
    this.name = 'FieldNotFoundError'
  }
}

const OPTION_IN_USE = /field_definitions\.options: option "(.+)" is still used by records/

/**
 * Friendly text for the `field_definitions` guard messages
 * (`protect_field_definition()`, docs/architecture.md). Null when the text is
 * not one of them.
 */
export function describeFieldGuardMessage(message: string): string | null {
  if (message.includes('field_definitions.key: cannot be changed')) return KEY_IMMUTABLE_MESSAGE
  if (message.includes('field_definitions.type: cannot be changed')) return TYPE_LOCKED_MESSAGE
  const inUse = OPTION_IN_USE.exec(message)
  if (inUse) {
    return `Option "${inUse[1]}" is still used by records. Reassign those records before removing it.`
  }
  return null
}

/** Friendly messages for module and field create, update and delete failures. */
export function getModuleErrorMessage(error: unknown): string {
  if (error instanceof ModuleNotFoundError) return error.message
  if (isPostgrestError(error)) {
    const text = `${error.message} ${error.details ?? ''}`
    switch (error.code) {
      case '23505': // unique_violation
        return /field_definitions/.test(text) ? FIELD_KEY_TAKEN_MESSAGE : MODULE_SLUG_TAKEN_MESSAGE
      case '23514': {
        // check_violation: constraint names, guard messages or plain shape checks
        if (/field_definitions_options_check/.test(text)) return OPTIONS_INVALID_MESSAGE
        if (/field_definitions_settings_check/.test(text)) return SETTINGS_INVALID_MESSAGE
        return describeFieldGuardMessage(error.message) ?? MODULE_CHECK_MESSAGE
      }
      case 'P0001': // raise_exception from a trigger (field cap or other guard)
        return describeFieldGuardMessage(error.message) ?? GENERIC_MODULE_ERROR_MESSAGE
      case '23503': // foreign_key_violation: module in another workspace or deleted
        return MODULE_NOT_FOUND_MESSAGE
      case '42501': // insufficient_privilege (RLS)
        return MODULE_FORBIDDEN_MESSAGE
      case 'PGRST116': // zero rows for .single(): hidden or gone
        return MODULE_NOT_FOUND_MESSAGE
      default:
        return GENERIC_MODULE_ERROR_MESSAGE
    }
  }
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE
  return GENERIC_MODULE_ERROR_MESSAGE
}
