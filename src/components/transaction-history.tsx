"use client";

import { useState, useTransition } from "react";
import { loadMoreTransactions, type TransactionRow } from "@/app/groups/transaction-actions";
import { formatMoney } from "@/lib/money";

export function TransactionHistory({
  initialRows,
  initialHasMore,
  names,
  receipts,
  initialError,
}: {
  initialRows: TransactionRow[];
  initialHasMore: boolean;
  names: Record<string, string>;
  receipts: Record<string, { file_name: string; signed_url: string }[]>;
  initialError?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState(initialError ?? "");
  const [isPending, startTransition] = useTransition();

  function loadMore() {
    const lastRow = rows.at(-1);
    if (!lastRow || isPending) return;

    setError("");
    startTransition(async () => {
      const result = await loadMoreTransactions(lastRow.created_at, lastRow.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRows((current) => [...current, ...(result.rows ?? [])]);
      setHasMore(result.hasMore ?? false);
    });
  }

  return (
    <section aria-labelledby="transaction-history-heading" className="panel transaction-history-panel" id="activity">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">THE LATEST</div>
          <h2 id="transaction-history-heading">Recent transactions</h2>
        </div>
        <span className="activity-count">{rows.length} shown</span>
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
                  {new Date(row.created_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                {(receipts[row.id] ?? []).map((receipt) => (
                  <a
                    className="receipt-link"
                    href={receipt.signed_url}
                    key={receipt.file_name}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View receipt · {receipt.file_name}
                  </a>
                ))}
              </div>
              <strong>{formatMoney(row.amount_minor, row.currency)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <div className="activity-empty">
          <span>☼</span>
          <b>No transactions yet</b>
          <small>Expenses and settlements will appear here.</small>
        </div>
      )}
      {error && <p aria-live="polite" className="form-message form-error">{error}</p>}
      {hasMore && (
        <button
          className="button button-outline button-small history-more"
          disabled={isPending}
          onClick={loadMore}
          type="button"
        >
          {isPending ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
