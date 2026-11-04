/**
 * Unit tests for csv.ts. Run with Deno 2 (no network or permissions needed):
 *   deno test supabase/functions/_shared/csv.test.ts
 * or, without a local Deno, through Docker (see docs/operations.md, "Edge Functions").
 */
import {
  buildCsv,
  CSV_BOM,
  type CsvField,
  csvRow,
  exportFileName,
  formatFieldCell,
  formatNumber,
  neutralizeFormula,
  quoteField,
  textCell,
} from './csv.ts'

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message ?? 'assertEquals'}: expected ${e}, got ${a}`)
}

const fields: CsvField[] = [
  { key: 'company', label: 'Company', type: 'text', options: [] },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'lead', label: 'Lead' },
      { value: 'active', label: 'Active' },
    ],
  },
  { key: 'value', label: 'Contract value', type: 'currency', options: [] },
  { key: 'due', label: 'Due date', type: 'date', options: [] },
  { key: 'done', label: 'Done', type: 'checkbox', options: [] },
  { key: 'qty', label: 'Qty', type: 'number', options: [] },
]

Deno.test('neutralizeFormula prefixes the six trigger characters only', () => {
  for (const c of ['=', '+', '-', '@', '\t', '\r']) {
    assertEquals(neutralizeFormula(`${c}x`), `'${c}x`, JSON.stringify(c))
  }
  assertEquals(neutralizeFormula('a=b'), 'a=b')
  assertEquals(neutralizeFormula(''), '')
  assertEquals(neutralizeFormula("'quoted"), "'quoted")
})

Deno.test('quoteField follows RFC 4180', () => {
  assertEquals(quoteField('plain'), 'plain')
  assertEquals(quoteField('a,b'), '"a,b"')
  assertEquals(quoteField('say "hi"'), '"say ""hi"""')
  assertEquals(quoteField('line\nbreak'), '"line\nbreak"')
  assertEquals(quoteField('cr\rx'), '"cr\rx"')
})

Deno.test('csvRow guards text cells, not numbers, and ends with CRLF', () => {
  assertEquals(
    csvRow([textCell('=HYPERLINK("x")'), { kind: 'number', value: '-42.5' }]),
    '"\'=HYPERLINK(""x"")",-42.5\r\n',
  )
})

Deno.test('formatNumber writes plain decimals', () => {
  assertEquals(formatNumber(12500.5), '12500.5')
  assertEquals(formatNumber(0), '0')
  assertEquals(formatNumber(-3), '-3')
  assertEquals(formatNumber(1e21), '1000000000000000000000')
  assertEquals(formatNumber(1e-7), '0.0000001')
  assertEquals(formatNumber(Number.NaN), null)
})

Deno.test('formatFieldCell per type', () => {
  const [company, status, value, due, done, qty] = fields
  assertEquals(formatFieldCell('Acme', company!), textCell('Acme'))
  assertEquals(formatFieldCell('active', status!), textCell('Active'))
  assertEquals(formatFieldCell('removed', status!), textCell('removed'), 'removed option keeps key')
  assertEquals(formatFieldCell(12500.5, value!), { kind: 'number', value: '12500.5' })
  assertEquals(formatFieldCell('2026-11-23', due!), textCell('2026-11-23'))
  assertEquals(formatFieldCell(true, done!), textCell('TRUE'))
  assertEquals(formatFieldCell(false, done!), textCell('FALSE'))
  assertEquals(formatFieldCell(null, qty!), textCell(''))
  assertEquals(formatFieldCell('7', qty!), textCell(''), 'mistyped value is empty')
})

Deno.test('buildCsv: BOM, header, rows, CRLF', () => {
  const csv = buildCsv(fields, [
    {
      title: 'Acme, Ltd',
      status: null,
      custom_values: { company: '@SUM(A1)', status: 'lead', value: -1, done: true },
      created_at: '2026-11-04T09:30:00.123456+00:00',
      updated_at: '2026-11-04T10:00:00+00:00',
    },
  ])
  assertEquals(csv.startsWith(CSV_BOM), true, 'starts with BOM')
  assertEquals(
    csv.slice(1),
    'Title,Record status,Company,Status,Contract value,Due date,Done,Qty,Created at,Updated at\r\n' +
      '"Acme, Ltd",,\'@SUM(A1),Lead,-1,,TRUE,,2026-11-04T09:30:00.123Z,2026-11-04T10:00:00.000Z\r\n',
  )
})

Deno.test('exportFileName uses the slug and the UTC date', () => {
  assertEquals(
    exportFileName('clients', new Date('2026-11-04T23:59:59Z')),
    'clients-2026-11-04.csv',
  )
  assertEquals(
    exportFileName('we"ird/slug', new Date('2026-01-02T00:00:00Z')),
    'we-ird-slug-2026-01-02.csv',
  )
})
