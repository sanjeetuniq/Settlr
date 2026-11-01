import type { Database } from "@/lib/database.types";

export type TransactionRow =
  Database["public"]["Functions"]["get_recent_transactions"]["Returns"][number];

export type EnrichedTransactionRow = TransactionRow & {
  comment: string | null;
  settlementAttachment: {
    file_name: string;
    signed_url: string;
  } | null;
};
