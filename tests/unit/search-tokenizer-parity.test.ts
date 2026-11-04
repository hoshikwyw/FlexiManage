import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyRecordsCriteria,
  buildPrefixTsQuery as frontendTsQuery,
  containsPattern,
  tokenizeSearch,
  type RecordsQueryBuilder,
} from '@/features/records/lib/records-filters'
import { createQueryBuilderMock, type QueryBuilderMock } from '@/test/query-builder-mock'

// The Deno module is plain TypeScript (no Deno APIs, no imports), so Vitest can load the very
// file export-records uses. tests/parity/search-tokenizer.deno.ts runs the same fixture under
// Deno itself.
import {
  MAX_SEARCH_TOKENS,
  buildPrefixTsQuery as backendTsQuery,
  searchTokens,
} from '../../supabase/functions/_shared/search.ts'

interface TokenizerCase {
  name: string
  input: string
  tokens: string[]
  tsQuery: string | null
}

type Builder = QueryBuilderMock & RecordsQueryBuilder<Builder>

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/search-tokenizer.json'), 'utf8'),
) as { cases: TokenizerCase[] }

describe('search tokenizer parity between the records table and export-records (C4)', () => {
  it('covers at least 40 fixture inputs with unique names', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40)
    expect(new Set(fixture.cases.map((c) => c.name)).size).toBe(fixture.cases.length)
  })

  it('caps both tokenizers at the same number of tokens', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ')
    expect(tokenizeSearch(many)).toHaveLength(MAX_SEARCH_TOKENS)
    expect(searchTokens(many)).toHaveLength(MAX_SEARCH_TOKENS)
  })

  describe.each(fixture.cases)('$name', ({ input, tokens, tsQuery }) => {
    it('gives the expected tokens in the frontend', () => {
      expect(tokenizeSearch(input)).toEqual(tokens)
    })

    it('gives the expected tokens in the Edge Function', () => {
      expect(searchTokens(input)).toEqual(tokens)
    })

    it('builds the same tsquery on both sides', () => {
      expect(frontendTsQuery(input)).toBe(tsQuery)
      expect(backendTsQuery(input)).toBe(tsQuery)
    })
  })

  // export-records applies the search as `term = search.trim()`; empty -> nothing; tsquery
  // -> textSearch('search_vector', q, simple); no token -> ilike('title', %term%).
  it.each(fixture.cases)('applies the export rule for the list search: $name', ({ input }) => {
    const builder = createQueryBuilderMock({ data: [], error: null }) as Builder
    applyRecordsCriteria(builder, { search: input, filters: [] })
    const term = input.trim()
    const tsQuery = backendTsQuery(term)
    const expected: [string, ...unknown[]][] = !term
      ? []
      : tsQuery
        ? [['textSearch', 'search_vector', tsQuery, { config: 'simple' }]]
        : [['ilike', 'title', containsPattern(term)]]
    expect(builder.calls).toEqual(expected)
  })
})
