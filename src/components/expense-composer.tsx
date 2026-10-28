"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpense } from "@/app/groups/actions";
import { parseAmountToMinorUnits, splitEvenly } from "@/lib/money";

type Member = { id: string; name: string };

export function ExpenseComposer({
  groupId,
  members,
}: {
  groupId: string;
  members: Member[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [category, setCategory] = useState("Food");
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [participants, setParticipants] = useState<string[]>(members.map((m) => m.id));
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptToRetry, setReceiptToRetry] = useState<{
    expenseId: string;
    file: File;
  } | null>(null);

  async function uploadReceipt(expenseId: string, file: File) {
    const uploadData = new FormData();
    uploadData.set("expenseId", expenseId);
    uploadData.set("file", file);

    try {
      const response = await fetch("/api/receipts", {
        method: "POST",
        body: uploadData,
      });
      if (response.ok) return null;

      const responseType = response.headers.get("content-type") ?? "";
      if (responseType.includes("application/json")) {
        const uploadResult = (await response.json()) as { error?: string };
        return (
          uploadResult.error ??
          "Receipt upload failed. Retry the upload without adding another expense."
        );
      }
      return "Receipt upload failed. Retry the upload without adding another expense.";
    } catch (error) {
      console.error("Receipt upload request failed:", error);
      return "Receipt upload failed. Check your connection and retry without adding another expense.";
    }
  }

  function submit(formData: FormData) {
    setErrorMessage("");
    setStatusMessage("");
    if (receiptToRetry) {
      setErrorMessage("Retry or remove the unsent receipt before adding another expense.");
      return;
    }
    const amount = String(formData.get("amount") ?? "");
    const amountMinor = parseAmountToMinorUnits(amount);
    const payerId = String(formData.get("payerId") ?? "");
    const description = String(formData.get("description") ?? "").trim();
    const spentAt = String(formData.get("spentAt") ?? "");
    if (!amountMinor) {
      setErrorMessage("Enter an amount with up to two decimal places.");
      return;
    }
    if (!participants.length) {
      setErrorMessage("Choose at least one person to split this expense.");
      return;
    }

    let shares: { user_id: string; amount_minor: number }[];
    if (splitMode === "equal") {
      shares = splitEvenly(amountMinor, participants);
    } else {
      shares = participants.map((userId) => ({
        user_id: userId,
        amount_minor: parseAmountToMinorUnits(customAmounts[userId] ?? "") ?? 0,
      }));
      if (shares.some((share) => share.amount_minor < 0)) {
        setErrorMessage("Enter a positive amount for every selected person.");
        return;
      }
      if (shares.reduce((sum, share) => sum + share.amount_minor, 0) !== amountMinor) {
        setErrorMessage("Custom shares must add up exactly to the total.");
        return;
      }
    }

    startTransition(async () => {
      const result = await createExpense({
        groupId,
        description,
        category,
        amount,
        payerId,
        spentAt,
        shares,
      });
      if (result.error || !result.expenseId) {
        setErrorMessage(result.error ?? "Expense could not be saved.");
        return;
      }

      if (receipt) {
        setReceiptToRetry({ expenseId: result.expenseId, file: receipt });
        const uploadError = await uploadReceipt(result.expenseId, receipt);
        if (uploadError) {
          setErrorMessage(`Expense saved, but ${uploadError}`);
          router.refresh();
          return;
        }
        setReceiptToRetry(null);
      }

      setErrorMessage("");
      setStatusMessage("Expense added. Your group balances are up to date.");
      setReceipt(null);
      router.refresh();
    });
  }

  function toggleParticipant(userId: string) {
    setParticipants((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  return (
    <form action={submit} className="stack-form">
      <div className="form-row">
        <label className="field-grow">
          What was it for?
          <input
            maxLength={120}
            name="description"
            placeholder="Dinner after the hike"
            required
          />
        </label>
        <label className="field-amount">
          Total
          <input
            inputMode="decimal"
            name="amount"
            placeholder="0.00"
            required
            step="0.01"
            type="number"
            min="0.01"
          />
        </label>
      </div>
      <div className="form-row">
        <label className="field-grow">
          Paid by
          <select name="payerId" required>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-grow">
          Category
          <select
            name="category"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            {["Food", "Transport", "Stay", "Utilities", "Other"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="field-date">
          Date
          <input
            defaultValue={new Date().toISOString().slice(0, 10)}
            name="spentAt"
            required
            type="date"
          />
        </label>
      </div>
      <fieldset className="participant-fieldset">
        <legend>Split between</legend>
        <div className="participant-list">
          {members.map((member) => {
            const selected = participants.includes(member.id);
            return (
              <div className="participant-row" key={member.id}>
                <label className="check-label">
                  <input
                    checked={selected}
                    onChange={() => toggleParticipant(member.id)}
                    type="checkbox"
                  />
                  <span>{member.name}</span>
                </label>
                {selected && splitMode === "custom" && (
                  <input
                    aria-label={`${member.name}'s share`}
                    className="share-input"
                    inputMode="decimal"
                    onChange={(event) =>
                      setCustomAmounts((current) => ({
                        ...current,
                        [member.id]: event.target.value,
                      }))
                    }
                    placeholder="0.00"
                    value={customAmounts[member.id] ?? ""}
                  />
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="form-row form-row-bottom">
        <div className="split-toggle" role="group" aria-label="Split type">
          <button
            aria-pressed={splitMode === "equal"}
            className={splitMode === "equal" ? "toggle-active" : ""}
            onClick={() => setSplitMode("equal")}
            type="button"
          >
            Split equally
          </button>
          <button
            aria-pressed={splitMode === "custom"}
            className={splitMode === "custom" ? "toggle-active" : ""}
            onClick={() => setSplitMode("custom")}
            type="button"
          >
            Custom amounts
          </button>
        </div>
        <label className="receipt-field">
          <span>Receipt (PNG/PDF, max 5 MB)</span>
          <input
            accept="image/png,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && file.size > 5 * 1024 * 1024) {
                setErrorMessage("Receipts must be 5 MB or smaller.");
                setReceipt(null);
                event.currentTarget.value = "";
                return;
              }
              setErrorMessage("");
              setReceipt(file);
            }}
            type="file"
          />
        </label>
      </div>
      {receipt && <p className="file-selected">{receipt.name}</p>}
      {receiptToRetry && (
        <div className="receipt-retry">
          <span>Expense saved. Retry attaching {receiptToRetry.file.name}.</span>
          <button
            className="button button-outline button-small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const uploadError = await uploadReceipt(
                  receiptToRetry.expenseId,
                  receiptToRetry.file,
                );
                if (uploadError) {
                  setErrorMessage(uploadError);
                  return;
                }
                setReceiptToRetry(null);
                setReceipt(null);
                setErrorMessage("");
                setStatusMessage("Receipt attached to the saved expense.");
                router.refresh();
              })
            }
            type="button"
          >
            Retry upload
          </button>
          <button
            className="button button-text button-small"
            disabled={pending}
            onClick={() => {
              setReceiptToRetry(null);
              setReceipt(null);
              setErrorMessage("");
              setStatusMessage("Expense saved without a receipt.");
            }}
            type="button"
          >
            Skip receipt
          </button>
        </div>
      )}
      {errorMessage && (
        <p aria-live="polite" className="form-message form-error">
          {errorMessage}
        </p>
      )}
      {statusMessage && (
        <p aria-live="polite" className="form-message form-success">
          {statusMessage}
        </p>
      )}
      <button className="button button-primary" disabled={pending || Boolean(receiptToRetry)}>
        {pending ? "Saving expense…" : "Add expense"}
      </button>
    </form>
  );
}
