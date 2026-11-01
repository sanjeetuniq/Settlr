"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SettlementCelebration } from "@/components/settlement-celebration";
import { formatMinorUnitsForInput } from "@/lib/money";
import { isValidSettlementComment } from "@/lib/settlement-validation";

type SettlementFormProps = {
  amountMinor: number;
  currency: string;
  fromUserId: string;
  groupId: string;
  toUserId: string;
};

export function SettlementForm({
  amountMinor,
  currency,
  fromUserId,
  groupId,
  toUserId,
}: SettlementFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [comment, setComment] = useState("");
  const [celebrationId, setCelebrationId] = useState<string>();
  const amountValue = formatMinorUnitsForInput(amountMinor, currency);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    if (!isValidSettlementComment(comment.trim())) {
      setErrorMessage("Keep the settlement note within 50 characters.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      try {
        const response = await fetch("/api/settlements", {
          method: "POST",
          body: formData,
        });
        const responseType = response.headers.get("content-type") ?? "";
        const result = responseType.includes("application/json")
          ? (await response.json()) as {
              error?: string;
              fullySettled?: boolean;
            }
          : {};
        if (!response.ok) {
          setErrorMessage(
            result.error ?? "The settlement could not be recorded. Refresh and try again.",
          );
          return;
        }

        setStatusMessage("Settlement recorded. This group’s balances are updated.");
        setComment("");
        form.reset();
        if (result.fullySettled) setCelebrationId(crypto.randomUUID());
        router.refresh();
      } catch (error) {
        console.error("Settlement request failed:", error);
        setErrorMessage("The settlement could not be recorded. Check your connection and try again.");
      }
    });
  }

  const commentLength = Array.from(comment).length;

  return (
    <>
      <SettlementCelebration celebrationId={celebrationId} />
      <form className="settlement-entry-form" onSubmit={submit}>
        <input name="groupId" type="hidden" value={groupId} />
        <input name="fromUserId" type="hidden" value={fromUserId} />
        <input name="toUserId" type="hidden" value={toUserId} />
        <label className="settlement-form-field">
          Amount to settle
          <input
            defaultValue={amountValue}
            inputMode="decimal"
            min={currency === "JPY" ? "1" : "0.01"}
            name="amount"
            required
            step={currency === "JPY" ? "1" : "0.01"}
            type="number"
          />
          <small>
            Suggested: {amountValue}. Pay less to leave a balance or more to reverse who owes.
          </small>
        </label>
        <label className="settlement-form-field">
          Comment <span className="settlement-optional">(optional)</span>
          <textarea
            maxLength={100}
            name="comment"
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add a short note"
            rows={2}
            value={comment}
          />
          <small>{commentLength}/50 characters</small>
        </label>
        <label className="settlement-form-field">
          Attachment <span className="settlement-optional">(optional)</span>
          <input accept="image/png,application/pdf" name="file" type="file" />
          <small>PNG or PDF, up to 5 MB.</small>
        </label>
        {errorMessage && (
          <p aria-live="polite" className="form-message form-error" role="alert">
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p aria-live="polite" className="form-message form-success" role="status">
            {statusMessage}
          </p>
        )}
        <button
          className="button button-primary button-small"
          disabled={pending || commentLength > 50}
          type="submit"
        >
          {pending ? "Recording…" : "Record settlement"}
        </button>
      </form>
    </>
  );
}
