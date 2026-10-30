/**
 * Handy aliases over the generated Supabase types (`npm run db:types`).
 * Import rows from here instead of digging into `Database['public']...`.
 */
import {
  Constants,
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from './supabase'

export type { Database } from './supabase'

export type Profile = Tables<'profiles'>
export type ProfileUpdate = TablesUpdate<'profiles'>

export type Workspace = Tables<'workspaces'>
export type WorkspaceInsert = TablesInsert<'workspaces'>
export type WorkspaceUpdate = TablesUpdate<'workspaces'>

export type WorkspaceMember = Tables<'workspace_members'>
export type WorkspaceMemberInsert = TablesInsert<'workspace_members'>

export type Invitation = Tables<'invitations'>
export type InvitationInsert = TablesInsert<'invitations'>

export type AuditEvent = Tables<'audit_events'>

export type WorkspaceRole = Enums<'workspace_role'>
export const WORKSPACE_ROLES = Constants.public.Enums.workspace_role
