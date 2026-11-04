/**
 * Search tokenizer, contract C4 (migration 006). The frontend's
 * `src/features/records/lib/records-filters.ts` implements the same rules; keep both identical.
 *
 * 1. NFC-normalise the input (as the frontend does, so composed and decomposed accents agree);
 * 2. split on every character that is not a letter (`\p{L}`), mark (`\p{M}`), digit (`\p{N}`)
 *    or one of `. @ - _ +` (whitespace is such a character);
 * 3. strip leading and trailing `. @ - _ +` from each token and drop empty tokens;
 * 4. lowercase, dedupe (first occurrence wins), keep at most 8;
 * 5. each token becomes `token:*`, joined with ` & `.
 *
 * No tokens -> null; the caller falls back to `title ilike %term%`. The surviving characters
 * have no meaning in tsquery syntax, so user input can never form operators. The server-side
 * document (`record_search_document`) indexes punctuated values whole, split at `@`, and split
 * into alphanumeric parts, so `jane@acme.example`, `acme`, `example.com` and `12500.5` all match.
 */

export const MAX_SEARCH_TOKENS = 8

const SEPARATORS = /[^\p{L}\p{M}\p{N}.@\-_+]+/u
const EDGE_PUNCTUATION = /^[.@\-_+]+|[.@\-_+]+$/g

/** The tokens of a search term after steps 1-4. */
export function searchTokens(term: string): string[] {
  const tokens = term
    .normalize('NFC')
    .split(SEPARATORS)
    .map((token) => token.replace(EDGE_PUNCTUATION, ''))
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase())
  return [...new Set(tokens)].slice(0, MAX_SEARCH_TOKENS)
}

/** `tok:* & tok:*` for `to_tsquery('simple', ...)`, or null when the term has no token. */
export function buildPrefixTsQuery(term: string): string | null {
  const tokens = searchTokens(term)
  return tokens.length > 0 ? tokens.map((token) => `${token}:*`).join(' & ') : null
}
