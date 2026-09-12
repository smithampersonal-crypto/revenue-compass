export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          contract_id: string
          created_at: string
          current_finalized_revision_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          current_finalized_revision_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          current_finalized_revision_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_current_finalized_revision_id_fkey"
            columns: ["current_finalized_revision_id"]
            isOneToOne: false
            referencedRelation: "analysis_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_revisions: {
        Row: {
          analysis_id: string
          canonical_inputs: Json
          created_at: string
          engine_outputs: Json | null
          engine_version: string | null
          finalized_at: string | null
          id: string
          lock_version: number
          reconciliation_snapshot: Json | null
          revision_number: number
          schema_version: string
          status: Database["public"]["Enums"]["arc_revision_status"]
          supersedes_revision_id: string | null
          updated_at: string
        }
        Insert: {
          analysis_id: string
          canonical_inputs: Json
          created_at?: string
          engine_outputs?: Json | null
          engine_version?: string | null
          finalized_at?: string | null
          id?: string
          lock_version?: number
          reconciliation_snapshot?: Json | null
          revision_number: number
          schema_version: string
          status?: Database["public"]["Enums"]["arc_revision_status"]
          supersedes_revision_id?: string | null
          updated_at?: string
        }
        Update: {
          analysis_id?: string
          canonical_inputs?: Json
          created_at?: string
          engine_outputs?: Json | null
          engine_version?: string | null
          finalized_at?: string | null
          id?: string
          lock_version?: number
          reconciliation_snapshot?: Json | null
          revision_number?: number
          schema_version?: string
          status?: Database["public"]["Enums"]["arc_revision_status"]
          supersedes_revision_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_revisions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_revisions_supersedes_revision_id_fkey"
            columns: ["supersedes_revision_id"]
            isOneToOne: false
            referencedRelation: "analysis_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          contract_number: string | null
          created_at: string
          customer_id: string
          id: string
          status: Database["public"]["Enums"]["arc_contract_status"]
          title: string
          updated_at: string
        }
        Insert: {
          contract_number?: string | null
          created_at?: string
          customer_id: string
          id?: string
          status?: Database["public"]["Enums"]["arc_contract_status"]
          title: string
          updated_at?: string
        }
        Update: {
          contract_number?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          status?: Database["public"]["Enums"]["arc_contract_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_upload_intents: {
        Row: {
          contract_id: string | null
          created_at: string
          display_name: string
          document_type: string | null
          effective_date: string | null
          expires_at: string
          guest_workspace_id: string | null
          id: string
          is_duplicate: boolean | null
          original_filename: string
          pending_object_path: string
          permanent_document_id: string | null
          permanent_object_path: string | null
          resolved_source_document_id: string | null
          state: string
          target_revision_id: string | null
          updated_at: string
          validated_byte_size: number | null
          validated_page_count: number | null
          validated_sha256: string | null
        }
        Insert: {
          contract_id?: string | null
          created_at?: string
          display_name: string
          document_type?: string | null
          effective_date?: string | null
          expires_at: string
          guest_workspace_id?: string | null
          id?: string
          is_duplicate?: boolean | null
          original_filename: string
          pending_object_path: string
          permanent_document_id?: string | null
          permanent_object_path?: string | null
          resolved_source_document_id?: string | null
          state?: string
          target_revision_id?: string | null
          updated_at?: string
          validated_byte_size?: number | null
          validated_page_count?: number | null
          validated_sha256?: string | null
        }
        Update: {
          contract_id?: string | null
          created_at?: string
          display_name?: string
          document_type?: string | null
          effective_date?: string | null
          expires_at?: string
          guest_workspace_id?: string | null
          id?: string
          is_duplicate?: boolean | null
          original_filename?: string
          pending_object_path?: string
          permanent_document_id?: string | null
          permanent_object_path?: string | null
          resolved_source_document_id?: string | null
          state?: string
          target_revision_id?: string | null
          updated_at?: string
          validated_byte_size?: number | null
          validated_page_count?: number | null
          validated_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_upload_intents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_intents_guest_workspace_id_fkey"
            columns: ["guest_workspace_id"]
            isOneToOne: false
            referencedRelation: "guest_workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_intents_resolved_source_document_id_fkey"
            columns: ["resolved_source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_upload_intents_target_revision_id_fkey"
            columns: ["target_revision_id"]
            isOneToOne: false
            referencedRelation: "analysis_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_source_document_selections: {
        Row: {
          created_at: string
          guest_workspace_id: string
          source_document_id: string
        }
        Insert: {
          created_at?: string
          guest_workspace_id: string
          source_document_id: string
        }
        Update: {
          created_at?: string
          guest_workspace_id?: string
          source_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_source_document_selections_guest_workspace_id_fkey"
            columns: ["guest_workspace_id"]
            isOneToOne: false
            referencedRelation: "guest_workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_source_document_selections_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_workspaces: {
        Row: {
          created_at: string
          draft_json: Json
          expires_at: string
          id: string
          lock_version: number
          migrated_analysis_id: string | null
          migrated_contract_id: string | null
          migrated_customer_id: string | null
          migrated_revision_id: string | null
          migrated_user_id: string | null
          schema_version: string
          status: Database["public"]["Enums"]["arc_guest_workspace_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_json: Json
          expires_at: string
          id?: string
          lock_version?: number
          migrated_analysis_id?: string | null
          migrated_contract_id?: string | null
          migrated_customer_id?: string | null
          migrated_revision_id?: string | null
          migrated_user_id?: string | null
          schema_version: string
          status?: Database["public"]["Enums"]["arc_guest_workspace_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_json?: Json
          expires_at?: string
          id?: string
          lock_version?: number
          migrated_analysis_id?: string | null
          migrated_contract_id?: string | null
          migrated_customer_id?: string | null
          migrated_revision_id?: string | null
          migrated_user_id?: string | null
          schema_version?: string
          status?: Database["public"]["Enums"]["arc_guest_workspace_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_workspaces_migrated_analysis_id_fkey"
            columns: ["migrated_analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_workspaces_migrated_contract_id_fkey"
            columns: ["migrated_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_workspaces_migrated_customer_id_fkey"
            columns: ["migrated_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_workspaces_migrated_revision_id_fkey"
            columns: ["migrated_revision_id"]
            isOneToOne: false
            referencedRelation: "analysis_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_source_documents: {
        Row: {
          created_at: string
          revision_id: string
          source_document_id: string
        }
        Insert: {
          created_at?: string
          revision_id: string
          source_document_id: string
        }
        Update: {
          created_at?: string
          revision_id?: string
          source_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_source_documents_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "analysis_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revision_source_documents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          archived_at: string | null
          byte_size: number
          contract_id: string | null
          created_at: string
          display_name: string
          document_type: string | null
          effective_date: string | null
          guest_workspace_id: string | null
          id: string
          original_filename: string
          page_count: number
          sha256: string
          storage_bucket: string
          storage_object_path: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          byte_size: number
          contract_id?: string | null
          created_at?: string
          display_name: string
          document_type?: string | null
          effective_date?: string | null
          guest_workspace_id?: string | null
          id?: string
          original_filename: string
          page_count: number
          sha256: string
          storage_bucket?: string
          storage_object_path: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          byte_size?: number
          contract_id?: string | null
          created_at?: string
          display_name?: string
          document_type?: string | null
          effective_date?: string | null
          guest_workspace_id?: string | null
          id?: string
          original_filename?: string
          page_count?: number
          sha256?: string
          storage_bucket?: string
          storage_object_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_guest_workspace_id_fkey"
            columns: ["guest_workspace_id"]
            isOneToOne: false
            referencedRelation: "guest_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_deletion_queue: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          reason: string
          storage_bucket: string
          storage_object_path: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          reason: string
          storage_bucket: string
          storage_object_path: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          reason?: string
          storage_bucket?: string
          storage_object_path?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      arc_create_contract_with_draft: {
        Args: {
          p_canonical_inputs: Json
          p_contract_number: string
          p_customer_id: string
          p_schema_version: string
          p_title: string
        }
        Returns: {
          analysis_id: string
          contract_id: string
          revision_id: string
        }[]
      }
      arc_delete_expired_guest_workspaces: { Args: never; Returns: number }
      arc_discard_amendment_draft: {
        Args: {
          p_expected_lock_version: number
          p_owner_user_id: string
          p_revision_id: string
        }
        Returns: string
      }
      arc_expire_guest_workspaces: { Args: never; Returns: number }
      arc_finalize_revision: {
        Args: {
          p_engine_outputs: Json
          p_engine_version: string
          p_expected_lock_version: number
          p_owner_user_id: string
          p_reconciliation_snapshot: Json
          p_revision_id: string
          p_schema_version: string
        }
        Returns: string
      }
      arc_migrate_guest_workspace: {
        Args: {
          p_contract_number: string
          p_contract_title: string
          p_customer_name: string
          p_guest_workspace_id: string
          p_owner_user_id: string
        }
        Returns: {
          analysis_id: string
          contract_id: string
          customer_id: string
          revision_id: string
        }[]
      }
      arc_migrate_guest_workspace_by_token: {
        Args: {
          p_contract_number: string
          p_contract_title: string
          p_customer_name: string
          p_expected_lock_version: number
          p_owner_user_id: string
          p_token_hash: string
        }
        Returns: {
          analysis_id: string
          contract_id: string
          customer_id: string
          idempotent: boolean
          revision_id: string
        }[]
      }
      arc_purge_user_guest_data: {
        Args: { p_guest_token_hash: string; p_user_id: string }
        Returns: number
      }
      arc_reset_amendment_draft: {
        Args: {
          p_expected_lock_version: number
          p_owner_user_id: string
          p_revision_id: string
        }
        Returns: {
          lock_version: number
          schema_version: string
          source_revision_id: string
        }[]
      }
      arc_source_document_in_history: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      arc_source_document_owner_present: {
        Args: { p_contract_id: string }
        Returns: boolean
      }
      arc_start_amendment_revision: {
        Args: {
          p_contract_id: string
          p_expected_source_revision_id: string
          p_owner_user_id: string
        }
        Returns: {
          created: boolean
          revision_id: string
        }[]
      }
    }
    Enums: {
      arc_contract_status: "active" | "archived"
      arc_guest_workspace_status:
        | "active"
        | "migrating"
        | "migrated"
        | "expired"
      arc_revision_status: "draft" | "finalized" | "superseded"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      arc_contract_status: ["active", "archived"],
      arc_guest_workspace_status: [
        "active",
        "migrating",
        "migrated",
        "expired",
      ],
      arc_revision_status: ["draft", "finalized", "superseded"],
    },
  },
} as const
