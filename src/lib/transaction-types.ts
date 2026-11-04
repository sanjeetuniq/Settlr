import type { Database } from "@/lib/database.types";

export type TransactionRow =
  Database["public"]["Functions"]["get_recent_transactions"]["Returns"][number];

export type FilteredTransactionRow =
  Database["public"]["Functions"]["get_filtered_transactions"]["Returns"][number];

type SettlementDetails = {
  comment: string | null;
  settlementAttachment: {
    file_name: string;
    signed_url: string;
  } | null;
};

export type EnrichedTransactionRow = TransactionRow & SettlementDetails;
export type EnrichedFilteredTransactionRow = FilteredTransactionRow & SettlementDetails;
