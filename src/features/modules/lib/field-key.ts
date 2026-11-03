/**
 * Field keys match the database check `^[a-z][a-z0-9_]{0,49}$`, are unique per
 * module and never change after creation (`field_definitions.key: cannot be
 * changed`). They are the property names inside `records.custom_values`.
 */
export const FIELD_KEY_MAX_LENGTH = 50
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/

/**
 * Derives a key from a label: strips diacritics, lowercases, turns every run of
 * other characters into one underscore, trims underscores, prefixes `f_` when
 * the result would start with a digit and cuts to 50 characters. Returns ''
 * when nothing usable remains (the form then asks for a key).
 */
export function deriveFieldKey(label: string): string {
  let key = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (key === '') return ''
  if (/^[0-9]/.test(key)) key = `f_${key}`
  return key.slice(0, FIELD_KEY_MAX_LENGTH).replace(/_+$/g, '')
}

export function isValidFieldKey(value: string): boolean {
  return FIELD_KEY_PATTERN.test(value)
}

/**
 * Select option values follow the same shape as keys (stable, machine
 * friendly) although the database only requires 1..100 distinct characters.
 */
export function deriveOptionValue(label: string): string {
  return deriveFieldKey(label)
}
