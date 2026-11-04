
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "content_type": string,"created_at": string,"file_name": string,"id": string,"record_id": string,"size_bytes": number,"storage_path": string,"uploaded_at": string | null,"uploaded_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_type": string,"created_at"?: string,"file_name": string,"id"?: string,"record_id": string,"size_bytes": number,"storage_path"?: never,"uploaded_at"?: string | null,"uploaded_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "content_type"?: string,"created_at"?: string,"file_name"?: string,"id"?: string,"record_id"?: string,"size_bytes"?: number,"storage_path"?: never,"uploaded_at"?: string | null,"uploaded_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_record_workspace_fkey"
      columns: ["record_id","workspace_id"]
isOneToOne: false
      referencedRelation: "records"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "attachments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": number,"metadata": NonNullable<Json>,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: never,"metadata"?: NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"field_definitions": {
                  Row: {
                    "created_at": string,"id": string,"key": string,"label": string,"module_id": string,"options": NonNullable<Json>,"position": number,"required": boolean,"settings": NonNullable<Json>,"type": Database["public"]['Enums']["field_type"],"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"key": string,"label": string,"module_id": string,"options"?: NonNullable<Json>,"position"?: number,"required"?: boolean,"settings"?: NonNullable<Json>,"type": Database["public"]['Enums']["field_type"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"key"?: string,"label"?: string,"module_id"?: string,"options"?: NonNullable<Json>,"position"?: number,"required"?: boolean,"settings"?: NonNullable<Json>,"type"?: Database["public"]['Enums']["field_type"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "field_definitions_module_id_fkey"
      columns: ["module_id"]
isOneToOne: false
      referencedRelation: "modules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_definitions_module_workspace_fkey"
      columns: ["module_id","workspace_id"]
isOneToOne: false
      referencedRelation: "modules"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "field_definitions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"role": Database["public"]['Enums']["workspace_role"],"token": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"token"?: string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"token"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"modules": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"icon": string | null,"id": string,"name": string,"position": number,"slug": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"icon"?: string | null,"id"?: string,"name": string,"position"?: number,"slug": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"icon"?: string | null,"id"?: string,"name"?: string,"position"?: number,"slug"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "modules_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "active": boolean,"billing_interval": string,"created_at": string,"currency": string,"key": string,"max_members": number,"max_modules": number,"max_records": number,"max_storage_bytes": number,"max_workspaces": number,"name": string,"position": number,"price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"billing_interval"?: string,"created_at"?: string,"currency"?: string,"key": string,"max_members": number,"max_modules": number,"max_records": number,"max_storage_bytes": number,"max_workspaces": number,"name": string,"position"?: number,"price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"billing_interval"?: string,"created_at"?: string,"currency"?: string,"key"?: string,"max_members"?: number,"max_modules"?: number,"max_records"?: number,"max_storage_bytes"?: number,"max_workspaces"?: number,"name"?: string,"position"?: number,"price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"email": string,"full_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"records": {
                  Row: {
                    "created_at": string,"created_by": string | null,"custom_values": NonNullable<Json>,"id": string,"module_id": string,"search_vector": unknown,"status": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"custom_values"?: NonNullable<Json>,"id"?: string,"module_id": string,"search_vector"?: never,"status"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"custom_values"?: NonNullable<Json>,"id"?: string,"module_id"?: string,"search_vector"?: never,"status"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_module_id_fkey"
      columns: ["module_id"]
isOneToOne: false
      referencedRelation: "modules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "records_module_workspace_fkey"
      columns: ["module_id","workspace_id"]
isOneToOne: false
      referencedRelation: "modules"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "records_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"storage_deletion_queue": {
                  Row: {
                    "attempts": number,"bucket_id": string,"enqueued_at": string,"id": number,"last_attempt_at": string | null,"last_error": string | null,"object_name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"bucket_id": string,"enqueued_at"?: string,"id"?: never,"last_attempt_at"?: string | null,"last_error"?: string | null,"object_name": string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"bucket_id"?: string,"enqueued_at"?: string,"id"?: never,"last_attempt_at"?: string | null,"last_error"?: string | null,"object_name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"subscriptions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"current_period_end": string | null,"id": string,"plan_key": string,"provider": string,"provider_customer_id": string | null,"provider_subscription_id": string | null,"status": Database["public"]['Enums']["subscription_status"],"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"current_period_end"?: string | null,"id"?: string,"plan_key"?: string,"provider"?: string,"provider_customer_id"?: string | null,"provider_subscription_id"?: string | null,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"current_period_end"?: string | null,"id"?: string,"plan_key"?: string,"provider"?: string,"provider_customer_id"?: string | null,"provider_subscription_id"?: string | null,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_plan_key_fkey"
      columns: ["plan_key"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "subscriptions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["workspace_role"],"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"updated_at"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: {
              "role": Database["public"]['Enums']["workspace_role"],"workspace_id": string,"workspace_name": string,"workspace_slug": string
            }[]
                           },
"attachment_content_type_is_allowed":
{ Args: { "p_content_type": string }; Returns: boolean
                           },
"attachment_file_name_is_valid":
{ Args: { "p_file_name": string }; Returns: boolean
                           },
"can_upload_attachment_object":
{ Args: { "p_metadata": Json,"p_name": string }; Returns: boolean
                           },
"change_workspace_plan":
{ Args: { "p_actor_id"?: string,"p_plan_key": string,"p_workspace_id": string }; Returns: {
              "changed": boolean,"from_plan": string,"over_limit": (string)[],"to_plan": string,"workspace_id": string
            }[]
                           },
"check_entitlement":
{ Args: { "p_delta"?: number,"p_resource": string,"p_workspace_id": string }; Returns: undefined
                           },
"check_workspace_entitlement":
{ Args: { "p_owner_id": string }; Returns: undefined
                           },
"current_user_workspace_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"entitlement_check_bypassed":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"entitlement_usage":
{ Args: { "p_resource": string,"p_workspace_id": string }; Returns: number
                           },
"field_options_are_valid":
{ Args: { "p_options": Json,"p_type": Database["public"]['Enums']["field_type"] }; Returns: boolean
                           },
"field_settings_are_valid":
{ Args: { "p_settings": Json,"p_type": Database["public"]['Enums']["field_type"] }; Returns: boolean
                           },
"has_workspace_role":
{ Args: { "p_roles": (Database["public"]['Enums']["workspace_role"])[],"p_workspace_id": string }; Returns: boolean
                           },
"invoke_purge_attachments":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"is_workspace_member":
{ Args: { "p_workspace_id": string }; Returns: boolean
                           },
"jsonb_values_text":
{ Args: { "p_values": Json }; Returns: string
                           },
"owned_workspace_allowance":
{ Args: { "p_user_id": string }; Returns: {
              "max_workspaces": number,"owned": number,"plan_key": string
            }[]
                           },
"record_search_document":
{ Args: { "p_status": string,"p_title": string,"p_values": Json }; Returns: unknown
                           },
"schedule_storage_maintenance":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"shares_workspace_with":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"sweep_stale_attachments":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"text_is_blank":
{ Args: { "p_value": string }; Returns: boolean
                           },
"update_record":
{ Args: { "p_expected_updated_at": string,"p_patch": Json,"p_record_id": string }; Returns: {
              "created_at": string,
"created_by": string | null,
"custom_values": NonNullable<Json>,
"id": string,
"module_id": string,
"search_vector": unknown,
"status": string | null,
"title": string,
"updated_at": string,
"workspace_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "records"
        isOneToOne: true
        isSetofReturn: false
      } },
"workspace_effective_plan":
{ Args: { "p_workspace_id": string }; Returns: {
              "active": boolean,
"billing_interval": string,
"created_at": string,
"currency": string,
"key": string,
"max_members": number,
"max_modules": number,
"max_records": number,
"max_storage_bytes": number,
"max_workspaces": number,
"name": string,
"position": number,
"price_cents": number,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "plans"
        isOneToOne: true
        isSetofReturn: false
      } },
"workspace_entitlements":
{ Args: { "p_workspace_id": string }; Returns: {
              "current_value": number,"limit_value": number,"over_limit": boolean,"plan": string,"resource": string
            }[]
                           },
"workspace_usage":
{ Args: { "p_workspace_id": string }; Returns: {
              "attachments": number,"members": number,"modules": number,"records": number,"storage_bytes": number
            }[]
                           }
          }
          Enums: {
            "field_type": "text"|"number"|"date"|"select"|"checkbox"|"currency","subscription_status": "active"|"past_due"|"canceled","workspace_role": "owner"|"admin"|"member"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "field_type": ["text", "number", "date", "select", "checkbox", "currency"],"subscription_status": ["active", "past_due", "canceled"],"workspace_role": ["owner", "admin", "member"]
          }
        }
} as const
