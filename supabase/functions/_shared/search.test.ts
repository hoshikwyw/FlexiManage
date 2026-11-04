/**
 * Unit tests for search.ts (contract C4). Run with Deno 2:
 *   deno test supabase/functions/_shared/search.test.ts
 * or through Docker (docs/operations.md, "Edge Functions").
 */
import { buildPrefixTsQuery, MAX_SEARCH_TOKENS, searchTokens } from './search.ts'

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message ?? 'assertEquals'}: expected ${e}, got ${a}`)
}

Deno.test('C4 queries for the documented inputs', () => {
  assertEquals(buildPrefixTsQuery('12500.5'), '12500.5:*')
  assertEquals(buildPrefixTsQuery('12500'), '12500:*')
  assertEquals(buildPrefixTsQuery('acme'), 'acme:*')
  assertEquals(buildPrefixTsQuery('jane@acme.example'), 'jane@acme.example:*')
  assertEquals(buildPrefixTsQuery('example.com'), 'example.com:*')
  assertEquals(buildPrefixTsQuery('-5'), '5:*')
  assertEquals(buildPrefixTsQuery('café'), 'café:*')
  assertEquals(buildPrefixTsQuery('ACME'), 'acme:*')
})

Deno.test(
  'splits on whitespace and on characters outside letters, marks, digits and . @ - _ +',
  () => {
    assertEquals(searchTokens('  Acme   Ltd '), ['acme', 'ltd'])
    assertEquals(searchTokens('foo-bar a_b c+d'), ['foo-bar', 'a_b', 'c+d'])
    assertEquals(searchTokens('a&b|c!d(e)f:g*h\'i"j<k>l\\m/n,o;p'), [
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ])
    assertEquals(buildPrefixTsQuery("o'brien & co: (draft)"), 'o:* & brien:* & co:* & draft:*')
  },
)

Deno.test('strips edge punctuation and drops empty tokens', () => {
  assertEquals(searchTokens('...hello... @world@ -x- _y_ +z+'), ['hello', 'world', 'x', 'y', 'z'])
  assertEquals(searchTokens('12500.'), ['12500'])
  assertEquals(buildPrefixTsQuery('- . @ _ +'), null)
  assertEquals(buildPrefixTsQuery('!!!'), null)
  assertEquals(buildPrefixTsQuery(''), null)
})

Deno.test('lowercases, dedupes and keeps at most eight tokens', () => {
  assertEquals(searchTokens('Acme ACME acme'), ['acme'])
  const many = Array.from({ length: 12 }, (_, i) => `w${i}`).join(' ')
  assertEquals(searchTokens(many).length, MAX_SEARCH_TOKENS)
  assertEquals(searchTokens(many).at(-1), 'w7')
})

Deno.test('NFC: composed and decomposed accents produce the same token', () => {
  assertEquals(searchTokens('café'), searchTokens('café'))
  assertEquals(searchTokens('Ärger Öl 東京 ٣'), ['ärger', 'öl', '東京', '٣'])
})
