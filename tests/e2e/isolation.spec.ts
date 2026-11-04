import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import {
  SEED_MODULES,
  SEED_PASSWORD,
  SEED_RECORDS,
  SEED_USERS,
  SEED_WORKSPACES,
} from '../fixtures/ids'
import { PIXEL_PNG } from './support/data'
import { count, lit, sql } from './support/db'
import { SKIP_WITHOUT_BACKEND, hasLocalBackend, runId } from './support/env'
import { chooseFiles, signIn, workspaceSwitcher } from './support/pages'

/**
 * Workspace isolation through the UI and the browser's own Supabase client (Epic A4, B2, B4):
 * bob (owner of Workspace B) probes alice's Workspace A by URL and through Storage. Alice's
 * attachment on the seed record Acme Ltd is created in setup through the UI and removed again
 * in teardown, so the seed is unchanged afterwards.
 */
test.skip(!hasLocalBackend, SKIP_WITHOUT_BACKEND)
test.describe.configure({ mode: 'serial' })

const A = SEED_WORKSPACES.a.id
const B = SEED_WORKSPACES.b.id
const CLIENTS = SEED_MODULES.clients.id
const PROJECTS = SEED_MODULES.projects.id
const ACME = SEED_RECORDS.acme.id
const fileName = `e2e-${runId()}-${Math.random().toString(36).slice(2, 6)}-secret.png`

let aliceContext: BrowserContext
let bobContext: BrowserContext
let alicePage: Page
let bobPage: Page
let attachment: { id: string; path: string }

interface StorageOutcome {
  ok: boolean
  error: string | null
}

/**
 * Run a Storage call with the app's own client (`/src/lib/supabase.ts`, the same module
 * instance the page uses, so the signed-in session applies). Only possible against the Vite
 * dev server, which the suite always uses.
 */
async function storageCall(
  page: Page,
  action: 'sign' | 'download' | 'upload' | 'remove',
  path: string,
): Promise<StorageOutcome> {
  return page.evaluate(
    async ({ action, path }) => {
      const clientModule = '/src/lib/supabase.ts'
      const { supabase } = await import(/* @vite-ignore */ clientModule)
      const bucket = supabase.storage.from('attachments')
      const result =
        action === 'sign'
          ? await bucket.createSignedUrl(path, 60)
          : action === 'download'
            ? await bucket.download(path)
            : action === 'upload'
              ? await bucket.upload(path, new Blob(['x'], { type: 'image/png' }), { upsert: false })
              : await bucket.remove([path])
      const data = result.data as unknown
      const empty = data === null || (Array.isArray(data) && data.length === 0)
      return {
        ok: !result.error && !empty,
        error: result.error ? String(result.error.message) : null,
      }
    },
    { action, path },
  )
}

async function attachmentRowsVisible(page: Page, id: string): Promise<number> {
  return page.evaluate(async (attachmentId) => {
    const clientModule = '/src/lib/supabase.ts'
    const { supabase } = await import(/* @vite-ignore */ clientModule)
    const { data, error } = await supabase.from('attachments').select('id').eq('id', attachmentId)
    if (error) throw new Error(error.message)
    return (data as unknown[]).length
  }, id)
}

test.beforeAll(async ({ browser }) => {
  aliceContext = await browser.newContext()
  bobContext = await browser.newContext()
  alicePage = await aliceContext.newPage()
  bobPage = await bobContext.newPage()

  await signIn(alicePage, SEED_USERS.alice.email, SEED_PASSWORD)
  await alicePage.goto(`/w/${A}/modules/${CLIENTS}/records/${ACME}`)
  await expect(alicePage.getByRole('heading', { name: 'Attachments' })).toBeVisible()
  await chooseFiles(alicePage, [{ name: fileName, mimeType: 'image/png', buffer: PIXEL_PNG }])
  await expect(
    alicePage.getByRole('list', { name: 'Attached files' }).getByText(fileName),
  ).toBeVisible()
  const row = await sql(
    `select id || '|' || storage_path from public.attachments where record_id = ${lit(ACME)} and file_name = ${lit(fileName)}`,
  )
  const [id = '', path = ''] = row.split('|')
  attachment = { id, path }
  expect(path.startsWith(`${A}/${ACME}/`)).toBe(true)
  // Control: the owner can sign the path, so the denials below are about the caller.
  expect(await storageCall(alicePage, 'sign', path)).toEqual({ ok: true, error: null })

  await signIn(bobPage, SEED_USERS.bob.email, SEED_PASSWORD)
})

test.afterAll(async () => {
  if (attachment?.id && alicePage) {
    // App order (B4): object first, then the row.
    await storageCall(alicePage, 'remove', attachment.path)
    await alicePage.evaluate(
      async ({ workspaceId, id }) => {
        const clientModule = '/src/lib/supabase.ts'
        const { supabase } = await import(/* @vite-ignore */ clientModule)
        await supabase.from('attachments').delete().eq('workspace_id', workspaceId).eq('id', id)
      },
      { workspaceId: A, id: attachment.id },
    )
  }
  await aliceContext?.close()
  await bobContext?.close()
  if (attachment?.id) {
    expect(await count('public.attachments', `id = ${lit(attachment.id)}`)).toBe(0)
    expect(
      await count(
        'storage.objects',
        `bucket_id = 'attachments' and name = ${lit(attachment.path)}`,
      ),
    ).toBe(0)
  }
})

test("denies bob workspace A's dashboard URL", async () => {
  await bobPage.goto(`/w/${A}`)
  await expect(bobPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible()
})

test('denies bob the Clients module URL of workspace A', async () => {
  await bobPage.goto(`/w/${A}/modules/${CLIENTS}`)
  await expect(bobPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible()
  await expect(bobPage.getByRole('table', { name: 'Records' })).toHaveCount(0)
})

test('denies bob the Acme record URL of workspace A', async () => {
  await bobPage.goto(`/w/${A}/modules/${CLIENTS}/records/${ACME}`)
  await expect(bobPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible()
  await expect(bobPage.getByText(SEED_RECORDS.acme.title)).toHaveCount(0)
})

test('denies bob the members URL of workspace A', async () => {
  await bobPage.goto(`/w/${A}/members`)
  await expect(bobPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible()
  await expect(bobPage.getByText(SEED_USERS.alice.fullName)).toHaveCount(0)
})

test("shows not found for A's module and record ids under bob's own workspace", async () => {
  await bobPage.goto(`/w/${B}/modules/${CLIENTS}`)
  await expect(bobPage.getByRole('heading', { name: 'Module not found' })).toBeVisible()
  await bobPage.goto(`/w/${B}/modules/${PROJECTS}/records/${ACME}`)
  await expect(bobPage.getByRole('heading', { name: 'Record not found' })).toBeVisible()
  await expect(bobPage.getByRole('heading', { name: 'Attachments' })).toHaveCount(0)
})

test("does not list workspace A in bob's switcher", async () => {
  await bobPage.goto(`/w/${B}`)
  await expect(workspaceSwitcher(bobPage)).toContainText(SEED_WORKSPACES.b.name)
  await workspaceSwitcher(bobPage).click()
  await expect(
    bobPage.getByRole('menuitem', { name: new RegExp(SEED_WORKSPACES.b.name) }),
  ).toBeVisible()
  await expect(
    bobPage.getByRole('menuitem', { name: new RegExp(SEED_WORKSPACES.a.name) }),
  ).toHaveCount(0)
  await bobPage.keyboard.press('Escape')
})

test("denies bob a signed URL for alice's attachment", async () => {
  const outcome = await storageCall(bobPage, 'sign', attachment.path)
  expect(outcome.ok).toBe(false)
  expect(outcome.error).not.toBeNull()
})

test("denies bob a direct download of alice's attachment", async () => {
  const outcome = await storageCall(bobPage, 'download', attachment.path)
  expect(outcome.ok).toBe(false)
  expect(outcome.error).not.toBeNull()
})

test("denies bob an upload under workspace A's prefix", async () => {
  const path = `${A}/${ACME}/${runId()}-bob.png`
  const outcome = await storageCall(bobPage, 'upload', path)
  expect(outcome.ok).toBe(false)
  expect(await count('storage.objects', `bucket_id = 'attachments' and name = ${lit(path)}`)).toBe(
    0,
  )
})

test("hides alice's attachment row from bob", async () => {
  expect(await attachmentRowsVisible(bobPage, attachment.id)).toBe(0)
  expect(await attachmentRowsVisible(alicePage, attachment.id)).toBe(1)
})
