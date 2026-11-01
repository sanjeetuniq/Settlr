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
        {
          id: string;
          display_name: string;
          avatar_path: string | null;
          created_at: string;
        },
        {
          id: string;
          display_name: string;
          avatar_path?: string | null;
          created_at?: string;
        }
      >;
      groups: Table<
        {
          id: string;
          name: string;
          currency: string;
          is_public: boolean;
          archived_at: string | null;
          created_by: string;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          currency?: string;
          is_public?: boolean;
          archived_at?: string | null;
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
          comment: string | null;
        },
        {
          id?: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          amount_minor: number;
          created_by: string;
          created_at?: string;
          comment?: string | null;
        }
      >;
      settlement_attachments: Table<
        {
          id: string;
          settlement_id: string;
          storage_path: string;
          file_name: string;
          content_type: string;
          size_bytes: number;
          uploaded_by: string;
          created_at: string;
        },
        {
          id?: string;
          settlement_id: string;
          storage_path: string;
          file_name: string;
          content_type: string;
          size_bytes: number;
          uploaded_by: string;
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
      whatsapp_preferences: Table<
        {
          user_id: string;
          phone_e164: string | null;
          phone_verified_at: string | null;
          phone_discoverable: boolean;
          opted_in_at: string | null;
          expense_alerts: boolean;
          invitation_alerts: boolean;
          reminder_alerts: boolean;
          settlement_alerts: boolean;
          updated_at: string;
        },
        {
          user_id: string;
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          phone_discoverable?: boolean;
          opted_in_at?: string | null;
          expense_alerts?: boolean;
          invitation_alerts?: boolean;
          reminder_alerts?: boolean;
          settlement_alerts?: boolean;
          updated_at?: string;
        }
      >;
      whatsapp_verification_codes: Table<
        {
          user_id: string;
          phone_e164: string;
          code_hash: string;
          expires_at: string;
          attempts: number;
        },
        {
          user_id: string;
          phone_e164: string;
          code_hash: string;
          expires_at: string;
          attempts?: number;
        }
      >;
      whatsapp_verification_rate_limits: Table<
        {
          user_id: string;
          window_started_at: string;
          sends_in_window: number;
          last_sent_at: string;
        },
        {
          user_id: string;
          window_started_at?: string;
          sends_in_window?: number;
          last_sent_at?: string;
        }
      >;
      whatsapp_phone_verification_rate_limits: Table<
        {
          phone_hash: string;
          window_started_at: string;
          sends_in_window: number;
          last_sent_at: string;
        },
        {
          phone_hash: string;
          window_started_at?: string;
          sends_in_window?: number;
          last_sent_at?: string;
        }
      >;
      whatsapp_notification_outbox: Table<
        {
          id: string;
          group_id: string;
          recipient_id: string;
          event_type: string;
          event_id: string;
          available_at: string;
          locked_until: string | null;
          attempts: number;
          sent_at: string | null;
          discarded_at: string | null;
          provider_message_id: string | null;
          last_error: string | null;
          created_at: string;
        },
        {
          id?: string;
          group_id: string;
          recipient_id: string;
          event_type: string;
          event_id: string;
          available_at?: string;
          locked_until?: string | null;
          attempts?: number;
          sent_at?: string | null;
          discarded_at?: string | null;
          provider_message_id?: string | null;
          last_error?: string | null;
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
      set_group_public: {
        Args: { p_group_id: string; p_is_public: boolean };
        Returns: undefined;
      };
      archive_group: { Args: { p_group_id: string }; Returns: undefined };
      join_open_group: { Args: { p_group_id: string }; Returns: string };
      list_open_groups: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; currency: string }[];
      };
      is_group_member: { Args: { p_group_id: string }; Returns: boolean };
      join_group_with_invite: { Args: { p_token_hash: string }; Returns: string };
      create_group_invite: {
        Args: { p_group_id: string; p_token_hash: string; p_expires_at: string };
        Returns: string;
      };
      search_group_invite_candidates: {
        Args: { p_group_id: string; p_query: string };
        Returns: {
          id: string;
          display_name: string;
          email: string | null;
          is_member: boolean;
        }[];
      };
      invite_group_member: {
        Args: { p_group_id: string; p_user_id: string };
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
      create_settlement_with_details: {
        Args: {
          p_group_id: string;
          p_from_user_id: string;
          p_to_user_id: string;
          p_amount_minor: number;
          p_comment: string | null;
          p_attachment_path: string | null;
          p_file_name: string | null;
          p_content_type: string | null;
          p_size_bytes: number | null;
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
      request_whatsapp_verification: {
        Args: { p_user_id: string; p_phone_e164: string; p_code_hash: string };
        Returns: undefined;
      };
      verify_whatsapp_code: {
        Args: { p_user_id: string; p_code_hash: string };
        Returns: boolean;
      };
      claim_whatsapp_notification_batch: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          group_id: string;
          recipient_id: string;
          event_type: string;
          phone_e164: string;
          attempts: number;
        }[];
      };
      get_recent_transactions: {
        Args: {
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number;
        };
        Returns: {
          id: string;
          group_id: string;
          group_name: string;
          currency: string;
          kind: string;
          description: string;
          amount_minor: number;
          created_at: string;
          person_a_id: string;
          person_b_id: string | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
