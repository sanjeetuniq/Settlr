export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      todos: Table<
        { id: number; name: string },
        { id?: number; name: string }
      >;
      profiles: Table<
        { id: string; display_name: string; created_at: string },
        { id: string; display_name: string; created_at?: string }
      >;
      groups: Table<
        {
          id: string;
          name: string;
          currency: string;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          currency?: string;
          created_by: string;
          created_at?: string;
        }
      >;
      group_members: Table<
        { group_id: string; user_id: string; joined_at: string },
        { group_id: string; user_id: string; joined_at?: string }
      >;
      group_invites: Table<
        {
          id: string;
          group_id: string;
          token_hash: string;
          created_by: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          group_id: string;
          token_hash: string;
          created_by: string;
          expires_at: string;
          revoked_at?: string | null;
          created_at?: string;
        }
      >;
      expenses: Table<
        {
          id: string;
          group_id: string;
          description: string;
          category: string;
          amount_minor: number;
          payer_id: string;
          spent_at: string;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          group_id: string;
          description: string;
          category?: string;
          amount_minor: number;
          payer_id: string;
          spent_at?: string;
          created_by: string;
          created_at?: string;
        }
      >;
      expense_shares: Table<
        { expense_id: string; user_id: string; amount_minor: number },
        { expense_id: string; user_id: string; amount_minor: number }
      >;
      settlements: Table<
        {
          id: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_minor: number;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_minor: number;
          created_by: string;
          created_at?: string;
        }
      >;
      expense_attachments: Table<
        {
          id: string;
          expense_id: string;
          group_id: string;
          storage_path: string;
          file_name: string;
          content_type: string;
          size_bytes: number;
          uploaded_by: string;
          created_at: string;
        },
        {
          id?: string;
          expense_id: string;
          group_id: string;
          storage_path: string;
          file_name: string;
          content_type: string;
          size_bytes: number;
          uploaded_by: string;
          created_at?: string;
        }
      >;
      reminders: Table<
        {
          id: string;
          group_id: string;
          recipient_id: string;
          created_by: string;
          message: string;
          read_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          group_id: string;
          recipient_id: string;
          created_by: string;
          message: string;
          read_at?: string | null;
          created_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      create_group: {
        Args: { p_name: string; p_currency: string };
        Returns: string;
      };
      is_group_member: { Args: { p_group_id: string }; Returns: boolean };
      join_group_with_invite: { Args: { p_token_hash: string }; Returns: string };
      create_group_invite: {
        Args: { p_group_id: string; p_token_hash: string; p_expires_at: string };
        Returns: string;
      };
      revoke_group_invite: { Args: { p_invite_id: string }; Returns: undefined };
      create_expense: {
        Args: {
          p_group_id: string;
          p_description: string;
          p_category: string;
          p_amount_minor: number;
          p_payer_id: string;
          p_spent_at: string;
          p_shares: Json;
        };
        Returns: string;
      };
      group_balances: {
        Args: { p_group_id: string };
        Returns: { user_id: string; balance_minor: number }[];
      };
      create_settlement: {
        Args: {
          p_group_id: string;
          p_from_user_id: string;
          p_to_user_id: string;
          p_amount_minor: number;
        };
        Returns: string;
      };
      send_in_app_reminder: {
        Args: { p_group_id: string; p_recipient_id: string; p_message: string };
        Returns: string;
      };
      mark_reminder_read: { Args: { p_reminder_id: string }; Returns: undefined };
      register_expense_attachment: {
        Args: {
          p_expense_id: string;
          p_storage_path: string;
          p_file_name: string;
          p_content_type: string;
          p_size_bytes: number;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
