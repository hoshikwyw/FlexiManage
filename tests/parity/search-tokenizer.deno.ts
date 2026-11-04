/**
 * The contract C4 tokenizer fixture under Deno, the runtime export-records actually uses
 * (tests/unit/search-tokenizer-parity.test.ts checks the same fixture for the frontend and the
 * Deno module under Node/Vitest). Written against `node:test` and `node:fs`, which Deno
 * supports, so the file also type-checks with the rest of tests/**.
 *
 *   deno test --no-lock --allow-read tests/parity/search-tokenizer.deno.ts
 *
 * Without a local Deno, mount only the two folders it reads (no package.json or node_modules,
 * so Deno uses its own Node types; Git Bash: prefix MSYS_NO_PATHCONV=1):
 *   docker run --rm -v "$PWD/tests:/repo/tests:ro" \
 *     -v "$PWD/supabase/functions:/repo/supabase/functions:ro" -w /repo denoland/deno:2.1.4 \
 *     test --no-lock --allow-read tests/parity/search-tokenizer.deno.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildPrefixTsQuery, searchTokens } from '../../supabase/functions/_shared/search.ts'

interface TokenizerCase {
  name: string
  input: string
  tokens: string[]
  tsQuery: string | null
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/search-tokenizer.json', import.meta.url)),
    'utf8',
  ),
) as { cases: TokenizerCase[] }

test('the fixture has at least 40 cases', () => {
  assert.ok(fixture.cases.length >= 40, `only ${fixture.cases.length} cases`)
})

for (const { name, input, tokens, tsQuery } of fixture.cases) {
  test(`searchTokens and buildPrefixTsQuery: ${name}`, () => {
    assert.deepEqual(searchTokens(input), tokens)
    assert.equal(buildPrefixTsQuery(input), tsQuery)
  })
}
