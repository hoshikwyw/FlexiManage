import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'

import { PIXEL_PNG, specData } from './support/data'
import { count, invitationToken, lit } from './support/db'
import { SKIP_WITHOUT_BACKEND, hasLocalBackend } from './support/env'
import {
  chooseFiles,
  createFirstWorkspace,
  createModuleFromTemplate,
  createRecord,
  downloadAttachment,
  exportCsv,
  fillRecordForm,
  fillSignUp,
  inviteMember,
  moduleUrl,
  openModule,
  recordTitles,
  recordsTable,
  signUp,
  toast,
  workspaceSwitcher,
} from './support/pages'

/**
 * Mandatory suite 4 (.claude/agents/test-engineer.md): the primary journey, end to end, with two
 * fresh users. Serial: every step builds on the previous one, and a retry restarts the group
 * with new users and names.
 */
test.skip(!hasLocalBackend, SKIP_WITHOUT_BACKEND)
test.describe.configure({ mode: 'serial' })

const data = specData('journey')
const owner = data.user('owner', `Olivia Owner ${data.tag}`)
const member = data.user('member', `Max Member ${data.tag}`)
const workspaceName = `Journey ${data.tag}`
const moduleName = `Tasks ${data.tag}`
const alpha = `Alpha ${data.tag}`
const bravo = `Bravo ${data.tag}`
const fileName = `pixel-${data.tag}.png`

const HOUSEKEEPING_FIELDS = [
  'Room',
  'Due date',
  'Task type',
  'Status',
  'Assigned to',
  'Guests arriving',
  'Notes',
  'Inspected',
]
const CSV_HEADER = `Title,Record status,${HOUSEKEEPING_FIELDS.join(',')},Created at,Updated at`

let ownerContext: BrowserContext
let memberContext: BrowserContext
let ownerPage: Page
let memberPage: Page
let workspaceId = ''
let moduleId = ''
let bravoId = ''

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext()
  memberContext = await browser.newContext()
  ownerPage = await ownerContext.newPage()
  memberPage = await memberContext.newPage()
})

test.afterAll(async () => {
  await ownerContext?.close()
  await memberContext?.close()
  // Account deletion removes the workspace (sole owner) with its module, records and attachments.
  await data.cleanup()
})

test('a new user signs up and lands on the create-workspace page', async () => {
  await signUp(ownerPage, owner)
  await expect(ownerPage).toHaveURL(/\/workspaces\/new$/)
  await expect(
    ownerPage.getByRole('heading', { name: 'Create your first workspace' }),
  ).toBeVisible()
})

test('creating a workspace makes the user its owner', async () => {
  workspaceId = await createFirstWorkspace(ownerPage, workspaceName)
  await expect(workspaceSwitcher(ownerPage)).toContainText(workspaceName)
  await expect(workspaceSwitcher(ownerPage)).toContainText('Owner')
})

test('applying the Housekeeping tasks template creates a module with 8 fields', async () => {
  moduleId = await createModuleFromTemplate(
    ownerPage,
    workspaceId,
    'Housekeeping tasks',
    moduleName,
  )
  await expect(toast(ownerPage, `Module "${moduleName}" created with 8 fields`)).toBeVisible()
  await ownerPage.getByRole('tab', { name: 'Fields' }).click()
  const fields = ownerPage.getByRole('table', { name: 'Fields' })
  await expect(fields.locator('tbody tr')).toHaveCount(8)
  for (const label of HOUSEKEEPING_FIELDS) {
    await expect(fields.getByRole('cell', { name: label, exact: true })).toBeVisible()
  }
  expect(await count('public.field_definitions', `module_id = ${lit(moduleId)}`)).toBe(8)
})

test('two records are created with the required select and date fields', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  await expect(ownerPage.getByRole('heading', { name: 'No records yet' })).toBeVisible()

  await createRecord(ownerPage, {
    title: alpha,
    selects: {
      'Room (required)': 'Room 1',
      'Task type (required)': 'Checkout clean',
      'Status (required)': 'To do',
    },
    texts: { 'Due date (required)': '2026-11-05' },
  })
  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  bravoId = await createRecord(ownerPage, {
    title: bravo,
    selects: {
      'Room (required)': 'Room 2',
      'Task type (required)': 'Deep clean',
      'Status (required)': 'To do',
    },
    texts: { 'Due date (required)': '2026-11-06' },
  })

  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  await expect(recordTitles(ownerPage)).toHaveCount(2)
  expect(
    await count(
      'public.records',
      `module_id = ${lit(moduleId)} and custom_values ? 'room' and custom_values ? 'due_date'`,
    ),
  ).toBe(2)
})

test('search and a filter each narrow the table to one record', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  await expect(recordTitles(ownerPage)).toHaveCount(2)

  await ownerPage.getByLabel('Search records').fill('alpha')
  await expect(recordTitles(ownerPage)).toHaveText([alpha])
  await expect(ownerPage).toHaveURL(/[?&]q=alpha/)
  await ownerPage.getByLabel('Search records').fill('')
  await expect(recordTitles(ownerPage)).toHaveCount(2)

  await ownerPage.getByRole('button', { name: /^Filters/ }).click()
  await ownerPage
    .getByRole('group', { name: 'Filters' })
    .getByRole('checkbox', { name: 'Room 2' })
    .click()
  await expect(recordTitles(ownerPage)).toHaveText([bravo])
  await expect(ownerPage.getByRole('list', { name: 'Active filters' })).toContainText('Room 2')
  await expect(ownerPage).toHaveURL(/[?&]f\.room=room_2/)
})

test('editing a record saves the changed values', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  await recordsTable(ownerPage).getByRole('link', { name: bravo }).click()
  await expect(ownerPage.getByRole('heading', { name: bravo, level: 1 })).toBeVisible()
  await ownerPage.getByRole('link', { name: 'Edit' }).click()
  await expect(ownerPage.getByRole('heading', { name: `Edit ${bravo}` })).toBeVisible()
  await fillRecordForm(ownerPage, {
    title: bravo,
    selects: { 'Status (required)': 'In progress' },
    texts: { 'Assigned to': 'Pat' },
  })
  await ownerPage.getByRole('button', { name: 'Save changes' }).click()
  await expect(toast(ownerPage, 'Record saved')).toBeVisible()
  await expect(ownerPage).not.toHaveURL(/edit=1/)
  await expect(ownerPage.locator('[data-field-key="status"]').getByRole('definition')).toHaveText(
    'In progress',
  )
  await expect(
    ownerPage.locator('[data-field-key="assigned_to"]').getByRole('definition'),
  ).toHaveText('Pat')
  const stored = await count(
    'public.records',
    `id = ${lit(bravoId)} and custom_values->>'status' = 'in_progress' and custom_values->>'assigned_to' = 'Pat'`,
  )
  expect(stored).toBe(1)
})

test('a PNG uploaded to the record downloads with identical bytes', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId, `/records/${bravoId}`))
  await expect(ownerPage.getByText('No files attached yet.')).toBeVisible()
  await chooseFiles(ownerPage, [{ name: fileName, mimeType: 'image/png', buffer: PIXEL_PNG }])
  const files = ownerPage.getByRole('list', { name: 'Attached files' })
  await expect(files.getByRole('listitem')).toHaveCount(1)
  await expect(files).toContainText(fileName)
  await expect(files).toContainText(`${PIXEL_PNG.length} B`)

  // Contract C1: the browser asks attachment-url for a short-lived signed URL; it never signs
  // or downloads through Storage itself.
  const storageReads: string[] = []
  const onRequest = (request: Request) => {
    if (/\/storage\/v1\/object\/(sign|authenticated)\//.test(new URL(request.url()).pathname)) {
      if (request.method() === 'POST' || !request.url().includes('token=')) {
        storageReads.push(`${request.method()} ${new URL(request.url()).pathname}`)
      }
    }
  }
  ownerPage.on('request', onRequest)
  const urlRequest = ownerPage.waitForResponse(
    (response) =>
      response.url().endsWith('/functions/v1/attachment-url') &&
      response.request().method() === 'POST',
  )
  const download = await downloadAttachment(ownerPage, fileName)
  ownerPage.off('request', onRequest)
  expect((await urlRequest).status()).toBe(200)
  expect(storageReads).toEqual([])
  expect(download.name).toBe(fileName)
  expect(download.bytes.equals(PIXEL_PNG)).toBe(true)
  expect(await count('public.attachments', `record_id = ${lit(bravoId)}`)).toBe(1)
})

test('the CSV export of the filtered view has a BOM, the header and one row', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId))
  await ownerPage.getByRole('button', { name: /^Filters/ }).click()
  await ownerPage
    .getByRole('group', { name: 'Filters' })
    .getByRole('checkbox', { name: 'Room 2' })
    .click()
  await expect(recordTitles(ownerPage)).toHaveText([bravo])

  const csv = await exportCsv(ownerPage)
  expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(csv.name).toMatch(/^tasks-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(csv.lines[0]).toBe(CSV_HEADER)
  expect(csv.lines).toHaveLength(2)
  expect(csv.lines[1]).toMatch(
    new RegExp(`^${bravo},,Room 2,2026-11-06,Deep clean,In progress,Pat,,,FALSE,`),
  )
})

test('the owner invites a second user as member', async () => {
  await inviteMember(ownerPage, workspaceId, member.email, 'member')
  const pending = ownerPage.getByRole('list', { name: 'Pending invitations' })
  await expect(pending.getByRole('listitem').filter({ hasText: member.email })).toContainText(
    'Member',
  )
})

test('the invitee signs up through the invite link and joins the workspace', async () => {
  const token = await invitationToken(workspaceId, member.email)
  await memberPage.goto(`/invite/${token}`)
  await expect(memberPage).toHaveURL(`/auth/sign-in?redirectTo=%2Finvite%2F${token}`)
  await memberPage.getByRole('link', { name: 'Create one' }).click()
  await expect(memberPage).toHaveURL(`/auth/sign-up?redirectTo=%2Finvite%2F${token}`)
  await fillSignUp(memberPage, member)
  await expect(toast(memberPage, `Joined ${workspaceName}`)).toBeVisible()
  await expect(memberPage).toHaveURL(`/w/${workspaceId}`)
  await expect(workspaceSwitcher(memberPage)).toContainText(workspaceName)
  await expect(workspaceSwitcher(memberPage)).toContainText('Member')
})

test('the member sees the module and both records', async () => {
  await openModule(memberPage, workspaceId, moduleName)
  await expect(recordTitles(memberPage)).toHaveCount(2)
  await expect(recordsTable(memberPage).getByRole('link', { name: alpha })).toBeVisible()
  await expect(recordsTable(memberPage).getByRole('link', { name: bravo })).toBeVisible()
})

test('the member has no Export CSV button and no danger zone', async () => {
  await memberPage.goto(moduleUrl(workspaceId, moduleId))
  await expect(recordTitles(memberPage)).toHaveCount(2)
  await expect(memberPage.getByRole('button', { name: 'Export CSV' })).toHaveCount(0)

  await expect(
    memberPage
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Workspace settings' }),
  ).toHaveCount(0)
  await memberPage.goto(`/w/${workspaceId}/settings`)
  await expect(memberPage.getByRole('heading', { name: 'Workspace settings' })).toBeVisible()
  await expect(memberPage.getByText('Danger zone')).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0)
})

test('after the owner removes the member, the workspace is gone for them', async () => {
  await ownerPage.goto(`/w/${workspaceId}/members`)
  const members = ownerPage.getByRole('table', { name: 'Members' })
  await expect(members.getByText(member.fullName)).toBeVisible()
  await ownerPage.getByRole('button', { name: `Actions for ${member.fullName}` }).click()
  await ownerPage.getByRole('menuitem', { name: 'Remove from workspace' }).click()
  await ownerPage
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove', exact: true })
    .click()
  await expect(toast(ownerPage, `${member.fullName} was removed`)).toBeVisible()
  await expect(members.getByText(member.fullName)).toHaveCount(0)

  await memberPage.goto(`/w/${workspaceId}`)
  await expect(memberPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible()
  await memberPage.goto('/')
  await expect(memberPage).toHaveURL(/\/workspaces\/new$/)
  await expect(
    memberPage.getByRole('heading', { name: 'Create your first workspace' }),
  ).toBeVisible()
})

test('deleting a record with an attachment shows in Recent activity with the file count', async () => {
  await ownerPage.goto(moduleUrl(workspaceId, moduleId, `/records/${bravoId}`))
  await expect(ownerPage.getByRole('heading', { name: bravo, level: 1 })).toBeVisible()
  await expect(ownerPage.getByRole('list', { name: 'Attached files' })).toContainText(fileName)
  await ownerPage.getByRole('button', { name: 'Delete', exact: true }).click()
  await ownerPage.getByRole('alertdialog').getByRole('button', { name: 'Delete record' }).click()
  await expect(toast(ownerPage, `Record "${bravo}" deleted`)).toBeVisible()
  await expect(ownerPage).toHaveURL(new RegExp(`/modules/${moduleId}$`))

  expect(await count('public.records', `id = ${lit(bravoId)}`)).toBe(0)
  // Contract C2/C5: the cascade removed the attachment row and queued its object.
  expect(
    await count(
      'public.storage_deletion_queue',
      `object_name like ${lit(`${workspaceId}/${bravoId}/%`)}`,
    ),
  ).toBe(1)
  expect(
    await count(
      'public.audit_events',
      `workspace_id = ${lit(workspaceId)} and action = 'record.deleted' and entity_id = ${lit(bravoId)} ` +
        `and metadata = jsonb_build_object('module_id', ${lit(moduleId)}::uuid, 'title', ${lit(bravo)}, 'attachment_count', 1)`,
    ),
  ).toBe(1)

  await ownerPage.goto(`/w/${workspaceId}`)
  await expect(ownerPage.getByRole('list', { name: 'Recent activity' })).toContainText(
    `${owner.fullName} deleted the record "${bravo}" (1 attachment)`,
  )
})
