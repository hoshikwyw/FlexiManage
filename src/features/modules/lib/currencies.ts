/**
 * ISO 4217 codes offered for currency fields. The database only checks the
 * `^[A-Z]{3}$` shape, so the list can grow without a migration.
 */
export const CURRENCY_CODES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'JPY',
  'AUD',
  'CAD',
] as const

export type CurrencyCode = (typeof CURRENCY_CODES)[number]

export const DEFAULT_CURRENCY: CurrencyCode = 'EUR'
export const DEFAULT_CURRENCY_PRECISION = 2

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value)
}
