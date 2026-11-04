import "server-only";

import type { EnrichedTransactionRow, TransactionRow } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

export async function addSettlementDetails<T extends TransactionRow>(
  rows: T[],
): Promise<(T & Omit<EnrichedTransactionRow, keyof TransactionRow>)[]> {
  const settlementIds = rows
    .filter((row) => row.kind === "settlement")
    .map((row) => row.id);
  if (settlementIds.length === 0) {
    return rows.map((row) => ({
      ...row,
      comment: null,
      settlementAttachment: null,
    }));
  }

  const supabase = await createClient();
  const [settlementResult, attachmentResult] = await Promise.all([
    supabase
      .from("settlements")
      .select("id, comment")
      .in("id", settlementIds),
    supabase
      .from("settlement_attachments")
      .select("settlement_id, file_name, storage_path")
      .in("settlement_id", settlementIds),
  ]);
  if (settlementResult.error) {
    throw new Error(`Settlement notes could not be loaded: ${settlementResult.error.message}`);
  }
  if (attachmentResult.error) {
    throw new Error(`Settlement attachments could not be loaded: ${attachmentResult.error.message}`);
  }

  const settlementComments = new Map(
    settlementResult.data.map((settlement) => [settlement.id, settlement.comment]),
  );
  const attachmentDetails = await Promise.all(
    attachmentResult.data.map(async (attachment) => {
      const { data, error } = await supabase.storage
        .from("expense-receipts")
        .createSignedUrl(attachment.storage_path, 600, { download: true });
      if (error) {
        throw new Error(`Settlement attachment link could not be created: ${error.message}`);
      }
      return [
        attachment.settlement_id,
        { file_name: attachment.file_name, signed_url: data.signedUrl },
      ] as const;
    }),
  );
  const attachmentsBySettlementId = new Map(attachmentDetails);

  return rows.map((row) => ({
    ...row,
    comment: row.kind === "settlement" ? settlementComments.get(row.id) ?? null : null,
    settlementAttachment:
      row.kind === "settlement" ? attachmentsBySettlementId.get(row.id) ?? null : null,
  }));
}
