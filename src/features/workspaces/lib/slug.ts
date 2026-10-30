/**
 * Workspace slugs must match the database check constraint:
 * `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..60 characters.
 */
export const SLUG_MAX_LENGTH = 60
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Derives a slug from free text: strips diacritics, lowercases, collapses
 * every run of other characters into one hyphen, trims hyphens and cuts to
 * `SLUG_MAX_LENGTH` without leaving a trailing hyphen. Returns '' when nothing
 * usable remains (the form then asks the user to type one).
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '')
}

export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value)
}
