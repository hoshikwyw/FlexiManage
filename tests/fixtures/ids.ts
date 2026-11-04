/**
 * Fixed identities created by `supabase/seed.sql` for local development and
 * tests. Keep both files in sync.
 *
 * Alice owns Workspace A and is not a member of B.
 * Bob owns Workspace B and is not a member of A.
 * Workspace A has one module (Clients) with four fields and three records;
 * Workspace B has one empty module (Projects).
 */

export const SEED_PASSWORD = 'password123'

export const SEED_USERS = {
  alice: {
    id: '00000000-0000-0000-0000-00000000000a',
    email: 'alice@example.com',
    fullName: 'Alice Example',
  },
  bob: {
    id: '00000000-0000-0000-0000-00000000000b',
    email: 'bob@example.com',
    fullName: 'Bob Example',
  },
} as const

export const SEED_WORKSPACES = {
  a: {
    id: '00000000-0000-0000-0000-0000000000aa',
    name: 'Workspace A',
    slug: 'workspace-a',
    ownerId: SEED_USERS.alice.id,
  },
  b: {
    id: '00000000-0000-0000-0000-0000000000bb',
    name: 'Workspace B',
    slug: 'workspace-b',
    ownerId: SEED_USERS.bob.id,
  },
} as const

export const SEED_MODULES = {
  clients: {
    id: '00000000-0000-0000-0000-0000000a0001',
    workspaceId: SEED_WORKSPACES.a.id,
    name: 'Clients',
    slug: 'clients',
  },
  projects: {
    id: '00000000-0000-0000-0000-0000000b0001',
    workspaceId: SEED_WORKSPACES.b.id,
    name: 'Projects',
    slug: 'projects',
  },
} as const

/** Fields of the Clients module (Workspace A), in `position` order. */
export const SEED_FIELDS = {
  company: {
    id: '00000000-0000-0000-0000-0000000f0001',
    moduleId: SEED_MODULES.clients.id,
    key: 'company',
    label: 'Company',
    type: 'text',
    required: true,
  },
  contactEmail: {
    id: '00000000-0000-0000-0000-0000000f0002',
    moduleId: SEED_MODULES.clients.id,
    key: 'contact_email',
    label: 'Contact email',
    type: 'text',
    required: false,
  },
  status: {
    id: '00000000-0000-0000-0000-0000000f0003',
    moduleId: SEED_MODULES.clients.id,
    key: 'status',
    label: 'Status',
    type: 'select',
    required: false,
    options: [
      { value: 'lead', label: 'Lead' },
      { value: 'active', label: 'Active' },
      { value: 'churned', label: 'Churned' },
    ],
  },
  value: {
    id: '00000000-0000-0000-0000-0000000f0004',
    moduleId: SEED_MODULES.clients.id,
    key: 'value',
    label: 'Contract value',
    type: 'currency',
    required: false,
    settings: { currency: 'EUR', precision: 2 },
  },
} as const

/** Records of the Clients module (Workspace A). */
export const SEED_RECORDS = {
  acme: {
    id: '00000000-0000-0000-0000-0000000e0001',
    moduleId: SEED_MODULES.clients.id,
    title: 'Acme Ltd',
    status: 'active',
  },
  globex: {
    id: '00000000-0000-0000-0000-0000000e0002',
    moduleId: SEED_MODULES.clients.id,
    title: 'Globex Corporation',
    status: 'lead',
  },
  initech: {
    id: '00000000-0000-0000-0000-0000000e0003',
    moduleId: SEED_MODULES.clients.id,
    title: 'Initech',
    status: 'churned',
  },
} as const

export type SeedUserKey = keyof typeof SEED_USERS
export type SeedWorkspaceKey = keyof typeof SEED_WORKSPACES
export type SeedModuleKey = keyof typeof SEED_MODULES
export type SeedFieldKey = keyof typeof SEED_FIELDS
export type SeedRecordKey = keyof typeof SEED_RECORDS

/**
 * Storage (migration 005). The private bucket holds attachment objects at
 * `<workspace_id>/<record_id>/<attachment_id>-<file_name>`. The seed creates no
 * attachments.
 */
export const STORAGE_BUCKETS = {
  attachments: 'attachments',
} as const
