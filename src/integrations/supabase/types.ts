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
      guest_workspaces: {
        Row: {
          created_at: string
          draft_json: Json
          expires_at: string
          id: string
          lock_version: number
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
          migrated_user_id?: string | null
          schema_version?: string
          status?: Database["public"]["Enums"]["arc_guest_workspace_status"]
          token_hash?: string
          updated_at?: string
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
          p_owner_user_id: string
          p_token_hash: string
        }
        Returns: {
          analysis_id: string
          contract_id: string
          customer_id: string
          revision_id: string
        }[]
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
