import { describe, expect, it } from 'vitest'

import { SLUG_MAX_LENGTH, SLUG_PATTERN, isValidSlug, slugify } from './slug'

describe('slugify', () => {
  it('lowercases and replaces spaces with single hyphens', () => {
    expect(slugify('Pilot Co')).toBe('pilot-co')
    expect(slugify('  Acme   Holdings  Ltd ')).toBe('acme-holdings-ltd')
  })

  it('collapses punctuation and symbol runs into one hyphen', () => {
    expect(slugify('Smith & Sons, Inc.')).toBe('smith-sons-inc')
    expect(slugify('a__b--c..d')).toBe('a-b-c-d')
  })

  it('strips diacritics and drops characters outside a-z0-9', () => {
    expect(slugify('Café Ümlaut Niño')).toBe('cafe-umlaut-nino')
    expect(slugify('東京 Office')).toBe('office')
    expect(slugify('日本語')).toBe('')
  })

  it('removes leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
    expect(slugify('!!!')).toBe('')
  })

  it('truncates to 60 characters without a trailing hyphen', () => {
    const long = `${'a'.repeat(59)} ${'b'.repeat(20)}`
    const result = slugify(long)
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(result).toBe('a'.repeat(59))
    expect(result).toMatch(SLUG_PATTERN)
    expect(slugify('x'.repeat(100))).toBe('x'.repeat(60))
  })

  it('keeps digits', () => {
    expect(slugify('Team 42')).toBe('team-42')
  })

  it('always produces either an empty string or a valid slug', () => {
    for (const input of ['Pilot Co', '  ', '---', 'Ünïcödé!', 'A'.repeat(200), 'a-b', '1']) {
      const slug = slugify(input)
      expect(slug === '' || isValidSlug(slug)).toBe(true)
    }
  })
})

describe('isValidSlug', () => {
  it('matches the database check constraint', () => {
    expect(isValidSlug('pilot-co')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
    expect(isValidSlug('Pilot')).toBe(false)
    expect(isValidSlug('-pilot')).toBe(false)
    expect(isValidSlug('pilot-')).toBe(false)
    expect(isValidSlug('pilot--co')).toBe(false)
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('a'.repeat(61))).toBe(false)
  })
})
