import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { changePlan } from './support/admin'
import { signUpViaApi } from './support/api'
import { specData } from './support/data'
import { count, lit, sql } from './support/db'
import { SKIP_WITHOUT_BACKEND, hasLocalBackend } from './support/env'
import {
  createFirstWorkspace,
  createModuleFromTemplate,
  createRecord,
  exportCsv,
  moduleUrl,
  recordTitles,
  recordsTable,
  signIn,
  toast,
} from './support/pages'

/**
 * Records after the Phase 3 review fixes (migration 006): the edit conflict of `update_record`
 * (contract C3), the search tokenizer and document (contract C4), and table/export parity (the
 * records list and `export-records` must match the same rows for the same criteria). Runs in
 * its own workspace with two modules from the "Clients" template: Company (text, required),
 * Contact email (text), Status (select lead/active/churned), Contract value (currency EUR).
 * Two modules exceed the Free plan (one module), so setup moves the workspace to Business through
 * the operator function `change-plan` (migration 007) before creating them.
 */
test.skip(!hasLocalBackend, SKIP_WITHOUT_BACKEND)
test.describe.configure({ mode: 'serial' })

const data = specData('records')
const owner = data.user('owner', `Rita Records ${data.tag}`)
const workspaceName = `Records ${data.tag}`
const clientsName = `Clients ${data.tag}`
const parityName = `Parity ${data.tag}`

let context: BrowserContext
let page: Page
let ownerId = ''
let workspaceId = ''
let clientsId = ''
let parityId = ''

test.beforeAll(async ({ browser }) => {
  ownerId = await signUpViaApi(owner)
  context = await browser.newContext()
  page = await context.newPage()
  await signIn(page, owner.email, owner.password)
  workspaceId = await createFirstWorkspace(page, workspaceName)
  await changePlan(workspaceId, 'business')
  clientsId = await createModuleFromTemplate(page, workspaceId, 'Clients', clientsName)
  parityId = await createModuleFromTemplate(page, workspaceId, 'Clients', parityName)
})

test.afterAll(async () => {
  await context?.close()
  await data.cleanup()
})

test.describe('search (contract C4)', () => {
  const acme = `Acme Ltd ${data.tag}`
  const jane = `Jane Doe ${data.tag}`
  const globex = `Globex ${data.tag}`

  test.beforeAll(async () => {
    await page.goto(moduleUrl(workspaceId, clientsId))
    await createRecord(page, {
      title: acme,
      texts: { 'Company (required)': 'Acme Ltd' },
      numbers: { 'Contract value': '12500.5' },
    })
    await page.goto(moduleUrl(workspaceId, clientsId))
    // Matches "acme" only through the domain of its contact email.
    await createRecord(page, {
      title: jane,
      texts: { 'Company (required)': 'Contoso', 'Contact email': 'jane@acme.example' },
    })
    await page.goto(moduleUrl(workspaceId, clientsId))
    // Decoy: 12500 is a prefix of 12500.5, not the other way round.
    await createRecord(page, {
      title: globex,
      texts: { 'Company (required)': 'Globex', 'Contact email': 'hank@globex.example' },
      numbers: { 'Contract value': '12500' },
    })
    expect(
      await count(
        'public.records',
        `module_id = ${lit(clientsId)} and custom_values->>'contact_email' = 'jane@acme.example'`,
      ),
    ).toBe(1)
  })

  test('searching a decimal finds the record with that contract value', async () => {
    await page.goto(moduleUrl(workspaceId, clientsId))
    await expect(recordTitles(page)).toHaveCount(3)
    await page.getByLabel('Search records').fill('12500.5')
    await expect(page).toHaveURL(/[?&]q=12500\.5/)
    await expect(recordTitles(page)).toHaveText([acme])
  })

  test('searching a domain part finds the record whose contact email contains it', async () => {
    await page.goto(moduleUrl(workspaceId, clientsId, '?q=acme'))
    await expect(recordTitles(page)).toHaveCount(2)
    await expect(recordsTable(page).getByRole('link', { name: jane })).toBeVisible()
    await expect(recordsTable(page).getByRole('link', { name: acme })).toBeVisible()
    await expect(recordsTable(page).getByRole('link', { name: globex })).toHaveCount(0)
  })
})

test.describe('edit conflict (contract C3)', () => {
  const title = `Hooli ${data.tag}`
  let recordId = ''

  test.beforeAll(async () => {
    await page.goto(moduleUrl(workspaceId, clientsId))
    recordId = await createRecord(page, { title, texts: { 'Company (required)': 'Hooli' } })
  })

  test('a stale save shows the conflict banner and Reload merges both edits', async () => {
    const editUrl = moduleUrl(workspaceId, clientsId, `/records/${recordId}?edit=1`)
    const second = await context.newPage()
    try {
      await page.goto(editUrl)
      await second.goto(editUrl)
      await expect(page.getByRole('heading', { name: `Edit ${title}` })).toBeVisible()
      await expect(second.getByRole('heading', { name: `Edit ${title}` })).toBeVisible()
      const company = (p: Page) => p.getByRole('textbox', { name: 'Company (required)' })
      const email = (p: Page) => p.getByRole('textbox', { name: 'Contact email', exact: true })

      // Page 1 saves the contact email first.
      await email(page).fill('first@hooli.example')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect(toast(page, 'Record saved')).toBeVisible()
      await expect(page).not.toHaveURL(/edit=1/)

      // Page 2 still holds the version it opened and changes a different field.
      await company(second).fill('Hooli XYZ')
      await second.getByRole('button', { name: 'Save changes' }).click()
      const banner = second
        .getByRole('alert')
        .filter({ hasText: 'This record was changed by someone else.' })
      await expect(banner).toBeVisible()
      await expect(second).toHaveURL(/edit=1/)
      await expect(company(second)).toHaveValue('Hooli XYZ')
      await expect(email(second)).toHaveValue('')
      expect(
        await count(
          'public.records',
          `id = ${lit(recordId)} and custom_values->>'company' = 'Hooli' ` +
            `and custom_values->>'contact_email' = 'first@hooli.example'`,
        ),
      ).toBe(1)

      // Reload keeps page 2's unsaved edit and takes page 1's saved change.
      await banner.getByRole('button', { name: 'Reload' }).click()
      await expect(
        second.getByRole('status').filter({ hasText: 'Loaded the latest version.' }),
      ).toBeVisible()
      await expect(banner).toHaveCount(0)
      await expect(company(second)).toHaveValue('Hooli XYZ')
      await expect(email(second)).toHaveValue('first@hooli.example')

      // The next save is based on the reloaded version and succeeds.
      await second.getByRole('button', { name: 'Save changes' }).click()
      await expect(toast(second, 'Record saved')).toBeVisible()
      await expect(second).not.toHaveURL(/edit=1/)
    } finally {
      await second.close()
    }

    const stored = await sql(
      `select custom_values->>'company' || '|' || (custom_values->>'contact_email') ` +
        `from public.records where id = ${lit(recordId)}`,
    )
    expect(stored).toBe('Hooli XYZ|first@hooli.example')
  })
})

test.describe('table and export parity', () => {
  /** Criteria in the URL contract of the records list (docs/architecture.md, Records feature). */
  const CRITERIA: { name: string; search: string; filtered: boolean }[] = [
    { name: 'no criteria', search: '', filtered: false },
    { name: 'one select option', search: '?f.status=active', filtered: true },
    { name: 'two select options', search: '?f.status=lead&f.status=churned', filtered: true },
    {
      name: 'number range and text filter',
      search: '?f.value=1000..5000&f.company=acme',
      filtered: true,
    },
    {
      name: 'search for a host and a select option',
      search: '?q=example.com&f.status=active',
      filtered: true,
    },
    {
      name: 'search for a domain part and a max-only range',
      search: '?q=acme&f.value=..4000',
      filtered: true,
    },
  ]

  test.beforeAll(async () => {
    // 30 records written as postgres in one statement (fast, deterministic); the validation
    // trigger still checks every value against the module's fields.
    await sql(
      `insert into public.records (workspace_id, module_id, title, custom_values, created_by) ` +
        `select ${lit(workspaceId)}, ${lit(parityId)}, 'Parity ' || lpad(g::text, 2, '0') || ' ' || ${lit(data.tag)}, ` +
        `jsonb_strip_nulls(jsonb_build_object(` +
        `'company', (array['Acme Ltd', 'Globex Corp', 'Initech'])[1 + g % 3], ` +
        `'contact_email', case when g % 4 = 0 then null else 'ops' || g || '@' || ` +
        `case when g % 2 = 0 then 'acme.example' else 'example.com' end end, ` +
        `'status', (array['lead', 'active', 'churned'])[1 + (g % 5) % 3], ` +
        `'value', case when g % 6 = 0 then null else g * 250.5 end)), ${lit(ownerId)} ` +
        `from generate_series(1, 30) g`,
    )
    expect(await count('public.records', `module_id = ${lit(parityId)}`)).toBe(30)
  })

  for (const criteria of CRITERIA) {
    test(`the table total equals the export row count for ${criteria.name}`, async () => {
      await page.goto(moduleUrl(workspaceId, parityId, criteria.search))
      await expect(recordsTable(page)).toBeVisible()
      const range = page.getByText(/^\d+–\d+ of \d+$/)
      await expect(range).toBeVisible()
      const total = Number(/of (\d+)$/.exec((await range.textContent()) ?? '')?.[1])
      if (criteria.filtered) {
        expect(total).toBeGreaterThan(0)
        expect(total).toBeLessThan(30)
      } else {
        expect(total).toBe(30)
      }

      const csv = await exportCsv(page)
      expect(csv.lines[0]).toMatch(/^Title,Record status,Company,Contact email,Status,/)
      expect(csv.lines.length - 1).toBe(total)
    })
  }
})
