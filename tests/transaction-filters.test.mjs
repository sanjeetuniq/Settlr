import test from "node:test";
import assert from "node:assert/strict";
import { resolveTransactionDateRange } from "../src/lib/transaction-filters.ts";

test("the current week starts Monday and includes today", () => {
  const range = resolveTransactionDateRange(
    { range: "week", timezone: "Asia/Kolkata" },
    new Date("2026-11-04T04:00:00.000Z"),
  );
  assert.deepEqual(range, { startDate: "2026-11-02", endDate: "2026-11-05" });
});

test("the current month ends after the current local day", () => {
  const range = resolveTransactionDateRange(
    { range: "month", timezone: "America/Los_Angeles" },
    new Date("2026-11-01T02:00:00.000Z"),
  );
  assert.deepEqual(range, { startDate: "2026-10-01", endDate: "2026-11-01" });
});

test("last quarter means the previous calendar quarter", () => {
  const range = resolveTransactionDateRange(
    { range: "quarter", timezone: "UTC" },
    new Date("2026-11-04T09:00:00.000Z"),
  );
  assert.deepEqual(range, { startDate: "2026-07-01", endDate: "2026-10-01" });
});

test("custom end dates are inclusive and converted to an exclusive upper bound", () => {
  const range = resolveTransactionDateRange({
    range: "custom",
    from: "2026-10-30",
    to: "2026-11-02",
    timezone: "Asia/Kolkata",
  });
  assert.deepEqual(range, { startDate: "2026-10-30", endDate: "2026-11-03" });
});

test("invalid dates and timezones are rejected", () => {
  assert.match(
    resolveTransactionDateRange({
      range: "custom",
      from: "2026-02-30",
      to: "2026-03-01",
      timezone: "UTC",
    }).error,
    /valid start and end dates/,
  );
  assert.match(
    resolveTransactionDateRange({ range: "week", timezone: "not/a-timezone" }).error,
    /valid timezone/,
  );
});
