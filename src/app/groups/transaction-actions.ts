"use server";

import { createClient } from "@/lib/supabase/server";
import { addSettlementDetails } from "@/lib/settlement-history";
import type { EnrichedTransactionRow } from "@/lib/transaction-types";

export type { TransactionRow } from "@/lib/transaction-types";

export type TransactionPage = {
  rows?: EnrichedTransactionRow[];
  hasMore?: boolean;
  error?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadMoreTransactions(
  beforeCreatedAt: string,
  beforeId: string,
): Promise<TransactionPage> {
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(beforeCreatedAt) ||
    Number.isNaN(Date.parse(beforeCreatedAt)) ||
    !uuidPattern.test(beforeId)
  ) {
    return { error: "That history page could not be loaded. Refresh and try again." };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Sign in again to continue." };
  }

  const { data, error } = await supabase.rpc("get_recent_transactions", {
    p_before_created_at: beforeCreatedAt,
    p_before_id: beforeId,
    p_limit: 21,
  });
  if (error) {
    console.error("Transaction history pagination failed:", error.message);
    return {
      error: ["PGRST202", "42883"].includes(error.code)
        ? "Apply the transaction-history migration to enable more history."
        : "More transactions could not be loaded. Try again.",
    };
  }

  try {
    return {
      rows: await addSettlementDetails(data.slice(0, 20)),
      hasMore: data.length > 20,
    };
  } catch (detailsError) {
    console.error("Transaction settlement details could not be loaded:", detailsError);
    return {
      error: "Settlement notes or attachments could not be loaded. Apply the latest migration and try again.",
    };
  }
}
