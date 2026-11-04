import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TransactionFilterForm } from "@/components/transaction-filter-form";
import { TransactionHistory } from "@/components/transaction-history";
import { addSettlementDetails } from "@/lib/settlement-history";
import { resolveTransactionDateRange } from "@/lib/transaction-filters";
import type { EnrichedFilteredTransactionRow } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = one(params.range) || "all";
  const timezone = one(params.tz) || "UTC";
  const from = one(params.from);
  const to = one(params.to);
  const personId = one(params.person);
  const groupId = one(params.group);
  const dateRange = resolveTransactionDateRange({ range, from, to, timezone });
  const invalidPerson = personId !== "" && !uuidPattern.test(personId);

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Ftransactions");

  const { data: membershipRows, error: membershipsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);
  if (membershipsError) {
    console.error("Transaction filter group lookup failed:", membershipsError.message);
    throw new Error("Transaction filters could not be loaded.");
  }
  const groupIds = membershipRows.map((row) => row.group_id);
  const memberIds = new Set<string>([user.id]);
  if (groupIds.length) {
    const { data: members, error: peopleError } = await supabase
      .from("group_members")
      .select("user_id")
      .in("group_id", groupIds);
    if (peopleError) {
      console.error("Transaction filter people lookup failed:", peopleError.message);
      throw new Error("People in your groups could not be loaded.");
    }
    members.forEach((member) => memberIds.add(member.user_id));
  }

  const peopleResult = memberIds.size
    ? await supabase.from("profiles").select("id, display_name").in("id", [...memberIds])
    : { data: [], error: null };
  if (peopleResult.error) {
    console.error("Transaction filter names query failed:", peopleResult.error.message);
    throw new Error("People in your groups could not be loaded.");
  }
  const people = (peopleResult.data ?? [])
    .map(({ id, display_name }) => ({ id, name: display_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const peopleNames = Object.fromEntries(people.map(({ id, name }) => [id, name]));

  let rows: EnrichedFilteredTransactionRow[] = [];
  let migrationNotice = "";
  if (!dateRange.error && !invalidPerson) {
    const { data, error } = await supabase.rpc("get_filtered_transactions", {
      p_person_id: personId || null,
      p_start_date: dateRange.startDate ?? null,
      p_end_date: dateRange.endDate ?? null,
      p_timezone: timezone,
    });
    if (error) {
      if (["PGRST202", "42883"].includes(error.code)) {
        migrationNotice =
          "Apply the settlement-notifications-and-filtered-transactions migration to enable filtered history.";
      } else {
        console.error("Filtered transaction query failed:", error.message);
        throw new Error("Transactions could not be loaded.");
      }
    } else {
      rows = await addSettlementDetails(data);
    }
  }

  const expenseIds = rows.filter((row) => row.kind === "expense").map((row) => row.id);
  const receipts: Record<string, { file_name: string; signed_url: string }[]> = {};
  if (expenseIds.length) {
    const { data: attachments, error: attachmentsError } = await supabase
      .from("expense_attachments")
      .select("expense_id, file_name, storage_path")
      .in("expense_id", expenseIds);
    if (attachmentsError) {
      console.error("Transaction receipt metadata query failed:", attachmentsError.message);
      throw new Error("Transaction receipts could not be loaded.");
    }
    const signedReceipts = await Promise.all(
      attachments.map(async (attachment) => {
        const { data, error } = await supabase.storage
          .from("expense-receipts")
          .createSignedUrl(attachment.storage_path, 600, { download: true });
        if (error) {
          console.error("Transaction receipt link creation failed:", error.message);
          throw new Error("A transaction receipt could not be opened.");
        }
        return { ...attachment, signed_url: data.signedUrl };
      }),
    );
    for (const receipt of signedReceipts) {
      (receipts[receipt.expense_id] ??= []).push({
        file_name: receipt.file_name,
        signed_url: receipt.signed_url,
      });
    }
  }

  const filterError = dateRange.error ?? (invalidPerson ? "Choose a valid person." : "");
  const rangeLabel =
    range === "quarter" ? "Previous calendar quarter" :
      range === "week" ? "This week" :
        range === "month" ? "This month" :
          range === "custom" ? `${from} through ${to}` : "All time";

  return (
    <AppShell activePage="transactions" groupId={groupId}>
      <section className="welcome-banner transactions-welcome">
        <div className="welcome-copy">
          <div className="eyebrow">YOUR ACTIVITY</div>
          <h1>Transactions</h1>
          <p>Search across your groups, then export the matching latest 50.</p>
        </div>
      </section>
      <section aria-label="Transaction filters" className="panel transaction-filters-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">FILTER YOUR HISTORY</div>
            <h2>Find a transaction</h2>
          </div>
        </div>
        <TransactionFilterForm
          from={from}
          groupId={groupId}
          people={people}
          personId={personId}
          range={range}
          timezone={timezone}
          to={to}
        />
        <p className="transaction-filter-note">
          Dates use your browser’s local calendar: expenses by spend date, settlements by recorded date.
          Current filter: {rangeLabel}.
        </p>
        {filterError && <p aria-live="polite" className="form-message form-error">{filterError}</p>}
        {migrationNotice && <p aria-live="polite" className="form-message form-error">{migrationNotice}</p>}
      </section>
      <TransactionHistory
        names={peopleNames}
        receipts={receipts}
        reportSummary={`${rangeLabel}${personId ? ` · ${peopleNames[personId] ?? "Selected person"}` : ""}`}
        rows={rows}
      />
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
        <span>Amounts stored securely · <a href="mailto:helpdesk_settlr@gmail.com">Support</a></span>
      </footer>
    </AppShell>
  );
}
