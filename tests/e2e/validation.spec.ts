import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'

import { signUpViaApi } from './support/api'
import { specData } from './support/data'
import { count, lit } from './support/db'
import { SKIP_WITHOUT_BACKEND, hasLocalBackend } from './support/env'
import {
  chooseFiles,
  createFirstWorkspace,
  createModuleFromTemplate,
  createRecord,
  moduleUrl,
  signIn,
  toast,
} from './support/pages'

/**
 * Client and server validation on the record form, the module form and attachments (B1, B2,
 * B4). Runs in its own workspace (owner signed up for this spec) with a module from the
 * "Clients" template: Company (text, required), Contact email, Status (select), Contract value.
 */
test.skip(!hasLocalBackend, SKIP_WITHOUT_BACKEND)
test.describe.configure({ mode: 'serial' })

const data = specData('validation')
const owner = data.user('owner', `Vera Validation ${data.tag}`)
const workspaceName = `Validation ${data.tag}`
const moduleName = `Clients ${data.tag}`
const recordTitle = `Umbrella ${data.tag}`

let context: BrowserContext
let page: Page
let workspaceId = ''
let moduleId = ''
let recordId = ''

/** Count non-GET requests to URLs matching `pattern` until `stop()` is called. */
function writeCounter(target: Page, pattern: RegExp): { readonly count: number; stop(): void } {
  let writes = 0
  const onRequest = (request: Request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD' && pattern.test(request.url())) {
      writes += 1
    }
  }
  target.on('request', onRequest)
  return {
    get count() {
      return writes
    },
    stop: () => target.off('request', onRequest),
  }
}

test.beforeAll(async ({ browser }) => {
  await signUpViaApi(owner)
  context = await browser.newContext()
  page = await context.newPage()
  await signIn(page, owner.email, owner.password)
  workspaceId = await createFirstWorkspace(page, workspaceName)
  moduleId = await createModuleFromTemplate(page, workspaceId, 'Clients', moduleName)
  await page.goto(moduleUrl(workspaceId, moduleId))
  recordId = await createRecord(page, {
    title: recordTitle,
    texts: { 'Company (required)': 'Umbrella Corp' },
  })
})

test.afterAll(async () => {
  await context?.close()
  await data.cleanup()
})

test('the record form shows required errors without sending a request', async () => {
  await page.goto(moduleUrl(workspaceId, moduleId, '/records/new'))
  await expect(page.getByRole('heading', { name: 'New record' })).toBeVisible()
  const writes = writeCounter(page, /\/rest\/v1\/records/)
  await page.getByRole('button', { name: 'Create record' }).click()

  await expect(page.getByLabel('Title', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Enter a title')).toBeVisible()
  const company = page.getByRole('textbox', { name: 'Company (required)', exact: true })
  await expect(company).toHaveAttribute('aria-invalid', 'true')
  await expect(company).toHaveAccessibleDescription(/This field is required/)
  // Zod runs synchronously in the submit handler: once the errors render, no request is coming.
  writes.stop()
  expect(writes.count).toBe(0)
  expect(await count('public.records', `module_id = ${lit(moduleId)}`)).toBe(1)
})

test('a required field added in another tab is reported on that field by the server', async () => {
  await page.goto(moduleUrl(workspaceId, moduleId, `/records/${recordId}?edit=1`))
  await expect(page.getByRole('heading', { name: `Edit ${recordTitle}` })).toBeVisible()

  // Second tab, same session: an admin adds a required field through the Fields tab.
  const other = await context.newPage()
  await other.goto(moduleUrl(workspaceId, moduleId, '?tab=fields'))
  await other.getByRole('button', { name: 'Add field' }).click()
  const dialog = other.getByRole('dialog')
  await dialog.getByLabel('Label').fill('Region')
  await expect(dialog.getByLabel('Key')).toHaveValue('region')
  await dialog.getByRole('checkbox', { name: 'Required' }).click()
  await dialog.getByRole('button', { name: 'Add field' }).click()
  await expect(toast(other, 'Field "Region" added')).toBeVisible()
  await other.close()

  // The first tab still has the old definitions, so only the server knows Region is required.
  await expect(page.getByLabel(/^Region/)).toHaveCount(0)
  await page.getByLabel('Contract value').fill('2000')
  const writes = writeCounter(page, /\/rest\/v1\/records/)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'The fields of this module changed' }),
  ).toBeVisible()
  const region = page.getByRole('textbox', { name: 'Region (required)', exact: true })
  await expect(region).toHaveAttribute('aria-invalid', 'true')
  await expect(region).toHaveAccessibleDescription(/This field is required/)
  writes.stop()
  expect(writes.count).toBe(1)
  expect(
    await count('public.records', `id = ${lit(recordId)} and not (custom_values ? 'value')`),
  ).toBe(1)
})

test('a duplicate module slug is refused with a message and creates nothing', async () => {
  await page.goto(`/w/${workspaceId}/modules`)
  await page.getByRole('button', { name: 'New module' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /^Blank/ }).check()
  await dialog.getByLabel('Module name').fill(moduleName)
  await dialog.getByRole('button', { name: 'Create module' }).click()
  await expect(
    dialog
      .getByRole('alert')
      .filter({ hasText: 'A module with this slug already exists in this workspace.' }),
  ).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(await count('public.modules', `workspace_id = ${lit(workspaceId)}`)).toBe(1)
})

test('attachments refuse an .exe and an 11 MB file without creating a row', async () => {
  await page.goto(moduleUrl(workspaceId, moduleId, `/records/${recordId}`))
  await expect(page.getByText('No files attached yet.')).toBeVisible()
  const writes = writeCounter(page, /\/rest\/v1\/attachments|\/storage\/v1\/object\//)

  await chooseFiles(page, [
    { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ fake') },
    {
      name: 'big-scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(11 * 1024 * 1024, 0x20),
    },
  ])
  const rejections = page.getByRole('alert').filter({ hasText: 'setup.exe' })
  await expect(rejections).toContainText('setup.exe: This file type is not allowed')
  await expect(rejections).toContainText('big-scan.pdf: Larger than 10 MB.')
  // Both files were refused by the local checks before any request (validateFile is synchronous).
  writes.stop()
  expect(writes.count).toBe(0)
  await expect(page.getByText('No files attached yet.')).toBeVisible()
  expect(await count('public.attachments', `record_id = ${lit(recordId)}`)).toBe(0)
})
