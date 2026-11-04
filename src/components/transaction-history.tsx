"use client";

import type { EnrichedFilteredTransactionRow } from "@/lib/transaction-types";
import { formatMoney } from "@/lib/money";

function csvCell(value: string) {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function TransactionHistory({
  rows,
  names,
  receipts,
  reportSummary,
}: {
  rows: EnrichedFilteredTransactionRow[];
  names: Record<string, string>;
  receipts: Record<string, { file_name: string; signed_url: string }[]>;
  reportSummary: string;
}) {
  function exportCsv() {
    const records = [
      ["Date", "Group", "Type", "Description", "Paid by", "Paid to", "Amount", "Currency", "Settlement note"],
      ...rows.map((row) => [
        row.activity_date,
        row.group_name,
        row.kind,
        row.description,
        names[row.person_a_id] ?? "Member",
        row.person_b_id ? names[row.person_b_id] ?? "Member" : "",
        formatMoney(row.amount_minor, row.currency),
        row.currency,
        row.comment ?? "",
      ]),
    ];
    const csv = records.map((record) => record.map((value) => csvCell(String(value))).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "settlr-transactions.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section aria-labelledby="transaction-history-heading" className="panel transaction-history-panel printable-transaction-report">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">THE LATEST · UP TO 50</div>
          <h2 id="transaction-history-heading">Transactions</h2>
          <p className="transaction-export-summary">{reportSummary} · {rows.length} shown</p>
        </div>
        <div className="transaction-export-actions no-print">
          <span className="activity-count">{rows.length} shown</span>
          <button className="button button-outline button-small" disabled={!rows.length} onClick={exportCsv} type="button">
            Export CSV
          </button>
          <button className="button button-outline button-small" disabled={!rows.length} onClick={() => window.print()} type="button">
            Save as PDF
          </button>
        </div>
      </div>
      {rows.length > 0 ? (
        <div className="transaction-list">
          {rows.map((row) => (
            <article className="transaction-row" key={`${row.kind}-${row.group_id}-${row.id}`}>
              <span className={`activity-category activity-${row.kind === "settlement" ? "settlement" : "food"}`}>
                {row.kind === "settlement" ? "⇄" : "↗"}
              </span>
              <div className="activity-description">
                <b>{row.description}</b>
                <span>
                  {row.kind === "settlement"
                    ? `${names[row.person_a_id] ?? "A group member"} paid ${names[row.person_b_id ?? ""] ?? "a group member"}`
                    : `${names[row.person_a_id] ?? "A group member"} paid`}
                  {" · "}{row.group_name} ·{" "}
                  {new Date(`${row.activity_date}T12:00:00`).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                {(receipts[row.id] ?? []).map((receipt) => (
                  <a
                    className="receipt-link no-print"
                    href={receipt.signed_url}
                    key={receipt.file_name}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View receipt · {receipt.file_name}
                  </a>
                ))}
                {row.comment && (
                  <small className="transaction-comment">Settlement note: {row.comment}</small>
                )}
                {row.settlementAttachment && (
                  <a className="receipt-link no-print" href={row.settlementAttachment.signed_url} rel="noreferrer" target="_blank">
                    View settlement attachment · {row.settlementAttachment.file_name}
                  </a>
                )}
              </div>
              <strong>{formatMoney(row.amount_minor, row.currency)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <div className="activity-empty">
          <span>☼</span>
          <b>No matching transactions</b>
          <small>Try changing the person or date filters.</small>
        </div>
      )}
    </section>
  );
}
