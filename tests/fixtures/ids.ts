/**
 * Fixed identities created by `supabase/seed.sql` for local development and
 * tests. Keep both files in sync.
 *
 * Alice owns Workspace A and is not a member of B.
 * Bob owns Workspace B and is not a member of A.
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

export type SeedUserKey = keyof typeof SEED_USERS
export type SeedWorkspaceKey = keyof typeof SEED_WORKSPACES
