/**
 * Handy aliases over the generated Supabase types (`npm run db:types`).
 * Import rows from here instead of digging into `Database['public']...`.
 */
import {
  Constants,
  type Database,
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from './supabase'

export type { Database }

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

// Content model (migration 004). `Record` is a TypeScript built-in, hence RecordRow.
export type Module = Tables<'modules'>
export type ModuleInsert = TablesInsert<'modules'>
export type ModuleUpdate = TablesUpdate<'modules'>

export type FieldDefinition = Tables<'field_definitions'>
export type FieldDefinitionInsert = TablesInsert<'field_definitions'>
export type FieldDefinitionUpdate = TablesUpdate<'field_definitions'>

export type FieldType = Enums<'field_type'>
export const FIELD_TYPES = Constants.public.Enums.field_type

export type RecordRow = Tables<'records'>
export type RecordInsert = TablesInsert<'records'>
export type RecordUpdate = TablesUpdate<'records'>

/** Shape of one entry of `field_definitions.options` (select fields only). */
export interface SelectOption {
  value: string
  label: string
}

/** Known keys of `field_definitions.settings`; unknown keys are preserved by the database. */
export interface FieldSettings {
  /** currency fields: ISO 4217 code, `^[A-Z]{3}$` */
  currency?: string
  /** number and currency fields: integer 0..6 */
  precision?: number
}

/** Row returned by `workspace_usage(p_workspace_id)`. */
export type WorkspaceUsage = Database['public']['Functions']['workspace_usage']['Returns'][number]
