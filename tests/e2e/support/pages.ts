import { expect, type Download, type Locator, type Page } from '@playwright/test'

import type { E2eUser } from './data'

/**
 * Thin page helpers. Every locator goes by role or label; the only exception in the suite is
 * `data-field-key` on the record detail, which scopes a `definition` to its field.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** The id that follows `segment/` in the current URL. */
export function idFromUrl(page: Page, segment: string): string {
  const match = new RegExp(`/${segment}/(${UUID})`).exec(new URL(page.url()).pathname)
  if (!match?.[1]) throw new Error(`no ${segment} id in ${page.url()}`)
  return match[1]
}

export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).first()
}

export async function fillSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Open the sign-in page and sign in; resolves once the app left `/auth/`. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/sign-in')
  await fillSignIn(page, email, password)
  await expect(page).not.toHaveURL(/\/auth\//)
}

/** Fill and submit the sign-up form on the current page (`/auth/sign-up[?redirectTo=...]`). */
export async function fillSignUp(page: Page, user: E2eUser): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByLabel('Full name').fill(user.fullName)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByLabel('Confirm password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

export async function signUp(page: Page, user: E2eUser): Promise<void> {
  await page.goto('/auth/sign-up')
  await fillSignUp(page, user)
  await expect(page).not.toHaveURL(/\/auth\//)
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/auth\/sign-in/)
}

/** On `/workspaces/new` (first run): create a workspace and return its id. */
export async function createFirstWorkspace(page: Page, name: string): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Create your first workspace' })).toBeVisible()
  const form = page.getByRole('form', { name: 'Create workspace' })
  await form.getByLabel('Workspace name').fill(name)
  await form.getByRole('button', { name: 'Create workspace' }).click()
  await expect(toast(page, `Workspace "${name}" created`)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/w/${UUID}$`))
  return idFromUrl(page, 'w')
}

export function workspaceSwitcher(page: Page): Locator {
  return page.getByRole('button', { name: /Switch workspace/ })
}

export async function switchWorkspace(page: Page, name: string): Promise<void> {
  await workspaceSwitcher(page).click()
  await page.getByRole('menuitem', { name }).click()
  await expect(workspaceSwitcher(page)).toContainText(name)
}

/**
 * On the Modules page: create a module from a template (radio label, for example
 * "Housekeeping tasks" or "Blank") under `name`. Returns the module id.
 */
export async function createModuleFromTemplate(
  page: Page,
  workspaceId: string,
  template: string,
  name: string,
): Promise<string> {
  await page.goto(`/w/${workspaceId}/modules`)
  await page.getByRole('button', { name: 'New module' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: new RegExp(`^${template}`) }).check()
  await dialog.getByLabel('Module name').fill(name)
  await dialog.getByRole('button', { name: 'Create module' }).click()
  await expect(toast(page, `Module "${name}" created`)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/modules/${UUID}$`))
  return idFromUrl(page, 'modules')
}

export function moduleUrl(workspaceId: string, moduleId: string, search = ''): string {
  return `/w/${workspaceId}/modules/${moduleId}${search}`
}

export async function openModule(page: Page, workspaceId: string, name: string): Promise<void> {
  await page.goto(`/w/${workspaceId}/modules`)
  await page
    .getByRole('list', { name: 'Modules' })
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('link', { name: 'Open' })
    .click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

export function recordsTable(page: Page): Locator {
  return page.getByRole('table', { name: 'Records' })
}

/** Title cells of the records table, for `toHaveText([...])`. */
export function recordTitles(page: Page): Locator {
  return recordsTable(page).locator('tbody tr').getByRole('link')
}

export interface RecordInput {
  title: string
  /** Accessible name of the control (required fields read "<Label> (required)") -> option label. */
  selects?: Record<string, string>
  /** Accessible name of a text-like input (text, date) -> value. */
  texts?: Record<string, string>
}

/** Fill the record form on the current page; option values are given by their visible label. */
export async function fillRecordForm(page: Page, input: RecordInput): Promise<void> {
  await page.getByLabel('Title', { exact: true }).fill(input.title)
  for (const [label, option] of Object.entries(input.selects ?? {})) {
    await page.getByRole('combobox', { name: label, exact: true }).selectOption({ label: option })
  }
  for (const [label, value] of Object.entries(input.texts ?? {})) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  }
}

/** From the module page: "New record", fill, create; resolves on the new record's page. */
export async function createRecord(page: Page, input: RecordInput): Promise<string> {
  await page.getByRole('link', { name: 'New record' }).first().click()
  await expect(page.getByRole('heading', { name: 'New record' })).toBeVisible()
  await fillRecordForm(page, input)
  await page.getByRole('button', { name: 'Create record' }).click()
  await expect(toast(page, `Record "${input.title}" created`)).toBeVisible()
  await expect(page.getByRole('heading', { name: input.title, level: 1 })).toBeVisible()
  return idFromUrl(page, 'records')
}

export interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** Pick files through the "Choose files" button (the keyboard path of the dropzone). */
export async function chooseFiles(page: Page, files: UploadFile[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles(files)
}

export async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export async function downloadAttachment(
  page: Page,
  fileName: string,
): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Download ${fileName}` }).click(),
  ])
  return { name: download.suggestedFilename(), bytes: await readDownload(download) }
}

export interface CsvDownload {
  name: string
  bytes: Buffer
  /** Text without the BOM, split on CRLF, trailing empty line dropped. */
  lines: string[]
}

/** Click "Export CSV" on the Records tab and read the file from the download event. */
export async function exportCsv(page: Page): Promise<CsvDownload> {
  const button = page.getByRole('button', { name: 'Export CSV' })
  await expect(button).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const bytes = await readDownload(download)
  await expect(toast(page, 'Export downloaded')).toBeVisible()
  const text = bytes.subarray(3).toString('utf8')
  const lines = text.split('\r\n')
  if (lines.at(-1) === '') lines.pop()
  return { name: download.suggestedFilename(), bytes, lines }
}

export async function inviteMember(
  page: Page,
  workspaceId: string,
  email: string,
  role: 'member' | 'admin',
): Promise<void> {
  await page.goto(`/w/${workspaceId}/members`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Role').selectOption(role)
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(toast(page, `Invitation created for ${email}`)).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Pending invitations' }).getByText(email),
  ).toBeVisible()
}
