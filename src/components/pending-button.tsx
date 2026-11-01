"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function PendingButton({
  children,
  pendingLabel = "Processing…",
  className = "button button-primary",
  disabled = false,
  type = "submit",
  ariaLabel,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        className={className}
        aria-label={ariaLabel}
        disabled={disabled || (type === "submit" && pending)}
        type={type}
      >
        {pending && type === "submit" ? pendingLabel : children}
      </button>
      {pending && type === "submit" && (
        <div aria-live="polite" className="processing-backdrop" role="status">
          <div className="processing-card">
            <span aria-hidden="true" className="processing-spinner" />
            <span>Processing your request…</span>
          </div>
        </div>
      )}
    </>
  );
}
