/**
 * Fixed identities for `tests/concurrency/concurrency.test.ts` (npm run test:concurrency).
 * Created committed (two database sessions must see them) at the start of the run and removed
 * at the end; the `...0cc...` range is distinct from the seed ids (tests/fixtures/ids.ts) and
 * from the pgTAP fixture ids (`...c0..`, supabase/tests/helpers/tests_schema.sql.inc). Do not
 * use these ids or the email for manual testing.
 */
export const CONCURRENCY = {
  user: {
    id: '00000000-0000-0000-0000-0000000cc001',
    email: 'concurrency-owner@example.com',
  },
  workspace: { id: '00000000-0000-0000-0000-0000000cc0aa', slug: 'concurrency-tests' },
  module: { id: '00000000-0000-0000-0000-0000000cc0a1', slug: 'concurrency' },
  fields: {
    /** text, required: every record has it. */
    company: { id: '00000000-0000-0000-0000-0000000cc0f1', key: 'company' },
    /** text, deleted and re-created by case (b). */
    x: { id: '00000000-0000-0000-0000-0000000cc0f2', key: 'x' },
    /** select with options a, b, c; option c is removed by case (c). */
    stage: { id: '00000000-0000-0000-0000-0000000cc0f3', key: 'stage' },
  },
  records: {
    /** Holds 9 uploaded attachments for case (a). */
    files: { id: '00000000-0000-0000-0000-0000000cc0e1' },
    /** Updated through update_record by case (d). */
    versioned: { id: '00000000-0000-0000-0000-0000000cc0e2' },
  },
} as const
