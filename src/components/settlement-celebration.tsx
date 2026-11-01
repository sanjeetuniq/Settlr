"use client";

import { useEffect, useState } from "react";

const balloons = ["🎈", "🎈", "🎉", "🎈", "🎊", "🎈", "🎉"];

export function SettlementCelebration({
  celebrationId,
}: {
  celebrationId?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (
      !celebrationId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        celebrationId,
      )
    ) {
      return;
    }

    const storageKey = `settlement-celebration:${celebrationId}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
    } catch (error) {
      console.error("Could not preserve settlement celebration state:", error);
    }

    const showTimeout = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(storageKey, "shown");
      } catch (error) {
        console.error("Could not preserve settlement celebration state:", error);
      }
      setActiveId(celebrationId);
    }, 0);
    const hideTimeout = window.setTimeout(() => setActiveId(null), 3000);
    return () => {
      window.clearTimeout(showTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [celebrationId]);

  if (!celebrationId || activeId !== celebrationId) return null;

  return (
    <div className="settlement-celebration" role="status" aria-live="polite">
      <div aria-hidden="true" className="celebration-balloons">
        {balloons.map((balloon, index) => (
          <span
            className={`celebration-balloon celebration-balloon-${index}`}
            key={`${balloon}-${index}`}
          >
            {balloon}
          </span>
        ))}
      </div>
      <div className="settlement-celebration-card">
        <span className="eyebrow">BALANCES CLEARED</span>
        <strong>All settled! Nicely done.</strong>
        <span>Thanks for keeping things clear with your people.</span>
      </div>
    </div>
  );
}
