import { isPostgrestError } from '@/lib/postgrest-errors'

/**
 * `validate_record_custom_values()` raises SQLSTATE 23514 with a message of the
 * form `custom_values.<key>: <reason>` (or `custom_values: <reason>` for the
 * object itself). See docs/architecture.md, "Custom value validation".
 */
const CUSTOM_VALUES_MESSAGE = /^custom_values(?:\.([a-z][a-z0-9_]*))?: (.+)$/

export interface CustomValuesError {
  /** Field key the message names; undefined when the whole object is at fault. */
  key?: string
  /** Server reason, for example `required` or `expected number`. */
  reason: string
}

/** Parses the raw server message; null when it is not a custom-values message. */
export function parseCustomValuesMessage(message: string): CustomValuesError | null {
  const match = CUSTOM_VALUES_MESSAGE.exec(message.trim())
  if (!match) return null
  const [, key, reason] = match
  return key ? { key, reason: reason ?? '' } : { reason: reason ?? '' }
}

/** Same for an unknown rejection: only 23514 errors with the expected message shape qualify. */
export function parseCustomValuesError(error: unknown): CustomValuesError | null {
  if (!isPostgrestError(error) || error.code !== '23514') return null
  return parseCustomValuesMessage(error.message)
}

const REASON_MESSAGES: Record<string, string> = {
  required: 'This field is required',
  'unknown field': 'This field no longer exists. Reload the page and try again.',
  'expected string': 'Enter text',
  'expected number': 'Enter a number',
  'expected boolean': 'Tick or untick the box',
  'expected date YYYY-MM-DD': 'Enter a valid date (YYYY-MM-DD)',
  'not one of the options': 'Choose one of the current options',
  'expected object': 'The record values were malformed. Reload the page and try again.',
}

/** Friendly text for a server reason; falls back to the reason itself. */
export function describeCustomValuesReason(reason: string): string {
  if (REASON_MESSAGES[reason]) return REASON_MESSAGES[reason]
  if (/^text longer than \d+ characters$/.test(reason)) {
    return `Use at most ${reason.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')} characters`
  }
  return reason
}
