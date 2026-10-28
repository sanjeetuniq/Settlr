import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoney,
  parseAmountToMinorUnits,
  simplifyBalances,
  splitEvenly,
} from "../src/lib/money.ts";
import { MAX_RECEIPT_BYTES, validateReceipt } from "../src/lib/receipt-validation.ts";
import { safeRedirectPath } from "../src/lib/safe-redirect.ts";

test("parses two-decimal amounts without floating point arithmetic", () => {
  assert.equal(parseAmountToMinorUnits("42"), 4200);
  assert.equal(parseAmountToMinorUnits("0.09"), 9);
  assert.equal(parseAmountToMinorUnits("10.5"), 1050);
  assert.equal(parseAmountToMinorUnits("10.555"), null);
  assert.equal(parseAmountToMinorUnits("-1.00"), null);
  assert.equal(parseAmountToMinorUnits("1e3"), null);
});

test("formats minor units to exactly two decimal places", () => {
  assert.match(formatMoney(5, "INR"), /0\.05/);
  assert.match(formatMoney(1200, "USD"), /12\.00/);
});

test("equal splits allocate remainder cents deterministically", () => {
  const shares = splitEvenly(100, ["c", "a", "b"]);
  assert.deepEqual(shares, [
    { user_id: "a", amount_minor: 34 },
    { user_id: "b", amount_minor: 33 },
    { user_id: "c", amount_minor: 33 },
  ]);
  assert.equal(shares.reduce((sum, share) => sum + share.amount_minor, 0), 100);
  assert.deepEqual(splitEvenly(1, ["b", "a", "c"]), [
    { user_id: "a", amount_minor: 1 },
    { user_id: "b", amount_minor: 0 },
    { user_id: "c", amount_minor: 0 },
  ]);
});

test("equal split rejects invalid totals or duplicate participants", () => {
  assert.throws(() => splitEvenly(0, ["a"]));
  assert.throws(() => splitEvenly(10, []));
  assert.throws(() => splitEvenly(10, ["a", "a"]));
});

test("simplified transfers reconcile all positive and negative balances", () => {
  const transfers = simplifyBalances([
    { user_id: "a", balance_minor: -700 },
    { user_id: "b", balance_minor: -300 },
    { user_id: "c", balance_minor: 600 },
    { user_id: "d", balance_minor: 400 },
  ]);
  assert.equal(
    transfers.reduce((sum, transfer) => sum + transfer.amount_minor, 0),
    1000,
  );
  assert.deepEqual(transfers, [
    { from_user_id: "a", to_user_id: "c", amount_minor: 600 },
    { from_user_id: "a", to_user_id: "d", amount_minor: 100 },
    { from_user_id: "b", to_user_id: "d", amount_minor: 300 },
  ]);
});

test("simplification rejects balances that do not net to zero", () => {
  assert.throws(() =>
    simplifyBalances([{ user_id: "a", balance_minor: -1 }]),
  );
});

test("receipt content validation checks signature, declared type, and size", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pdf = new TextEncoder().encode("%PDF-1.7");
  assert.deepEqual(validateReceipt(png, "image/png"), {
    valid: true,
    contentType: "image/png",
  });

  test("auth redirects accept local paths and reject external destinations", () => {
    assert.equal(safeRedirectPath("/?invite=abc"), "/?invite=abc");
    assert.equal(safeRedirectPath("//outside.example"), "/");
    assert.equal(safeRedirectPath("/\\outside.example"), "/");
    assert.equal(safeRedirectPath("https://outside.example/path"), "/");
    assert.equal(safeRedirectPath("relative/path"), "/");
  });
  assert.deepEqual(validateReceipt(pdf, "application/pdf"), {
    valid: true,
    contentType: "application/pdf",
  });
  assert.equal(validateReceipt(png, "application/pdf").valid, false);
  assert.equal(validateReceipt(new Uint8Array([0, 1, 2]), "image/png").valid, false);
  assert.equal(
    validateReceipt(new Uint8Array(MAX_RECEIPT_BYTES + 1), "image/png").valid,
    false,
  );
});
