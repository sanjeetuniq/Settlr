import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoney,
  formatMinorUnitsForInput,
  getBalanceDetails,
  getSettlementParties,
  parseAmountToMinorUnits,
  simplifyBalances,
  splitEvenly,
} from "../src/lib/money.ts";
import { MAX_RECEIPT_BYTES, validateReceipt } from "../src/lib/receipt-validation.ts";
import { safeRedirectPath } from "../src/lib/safe-redirect.ts";
import {
  getSupportedOtpType,
  isSignupConfirmation,
} from "../src/lib/auth-callback.ts";
import { isValidSettlementComment } from "../src/lib/settlement-validation.ts";
import {
  MAX_AVATAR_BYTES,
  validateAvatar,
} from "../src/lib/avatar-validation.ts";

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
  assert.equal(formatMinorUnitsForInput(1200, "INR"), "12.00");
  assert.equal(formatMinorUnitsForInput(1200, "JPY"), "1200");
});

test("accepts Supabase email OTP confirmation links", () => {
  assert.equal(getSupportedOtpType("email"), "email");
  assert.equal(getSupportedOtpType("signup"), "signup");
  assert.equal(getSupportedOtpType("email_change"), null);
  assert.equal(isSignupConfirmation(null, "email"), true);
  assert.equal(isSignupConfirmation("signup", null), true);
  assert.equal(isSignupConfirmation("recovery", "recovery"), false);
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

test("partial settlements recalculate remaining group suggestions", () => {
  const beforeSettlement = simplifyBalances([
    { user_id: "debtor", balance_minor: -1000 },
    { user_id: "creditor-a", balance_minor: 800 },
    { user_id: "creditor-b", balance_minor: 200 },
  ]);
  assert.deepEqual(beforeSettlement, [
    { from_user_id: "debtor", to_user_id: "creditor-a", amount_minor: 800 },
    { from_user_id: "debtor", to_user_id: "creditor-b", amount_minor: 200 },
  ]);

  const afterSettlement = simplifyBalances([
    { user_id: "debtor", balance_minor: -500 },
    { user_id: "creditor-a", balance_minor: 300 },
    { user_id: "creditor-b", balance_minor: 200 },
  ]);
  assert.deepEqual(afterSettlement, [
    { from_user_id: "debtor", to_user_id: "creditor-a", amount_minor: 300 },
    { from_user_id: "debtor", to_user_id: "creditor-b", amount_minor: 200 },
  ]);
});

test("balance details retain each transfer's group and direction", () => {
  const groups = [
    {
      group_id: "trip",
      group_name: "Trip",
      currency: "INR",
      transfers: [
        { from_user_id: "me", to_user_id: "a", amount_minor: 500 },
      ],
    },
    {
      group_id: "home",
      group_name: "Home",
      currency: "USD",
      transfers: [
        { from_user_id: "b", to_user_id: "me", amount_minor: 250 },
      ],
    },
  ];

  assert.deepEqual(getBalanceDetails(groups, "me", "owe"), [
    {
      group_id: "trip",
      group_name: "Trip",
      currency: "INR",
      counterpart_id: "a",
      amount_minor: 500,
    },
  ]);
  assert.deepEqual(getBalanceDetails(groups, "me", "owed"), [
    {
      group_id: "home",
      group_name: "Home",
      currency: "USD",
      counterpart_id: "b",
      amount_minor: 250,
    },
  ]);
});

test("settlements from balance details use the correct payer and group party", () => {
  assert.deepEqual(getSettlementParties("me", "friend", "owe"), {
    from_user_id: "me",
    to_user_id: "friend",
  });
  assert.deepEqual(getSettlementParties("me", "friend", "owed"), {
    from_user_id: "friend",
    to_user_id: "me",
  });
});

test("over-settlements reverse the pair balance without changing the group total", () => {
  const balancesAfterOverpayment = [
    { user_id: "debtor", balance_minor: 500 },
    { user_id: "creditor", balance_minor: -500 },
  ];
  assert.deepEqual(simplifyBalances(balancesAfterOverpayment), [
    { from_user_id: "creditor", to_user_id: "debtor", amount_minor: 500 },
  ]);
  assert.equal(
    balancesAfterOverpayment.reduce((total, balance) => total + balance.balance_minor, 0),
    0,
  );
});

test("settlement comments allow at most 50 Unicode characters", () => {
  assert.equal(isValidSettlementComment("a".repeat(50)), true);
  assert.equal(isValidSettlementComment("a".repeat(51)), false);
  assert.equal(isValidSettlementComment("🙂".repeat(50)), true);
  assert.equal(isValidSettlementComment("🙂".repeat(51)), false);
});

test("profile photo validation checks PNG, JPEG, WebP signatures, and size", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.deepEqual(validateAvatar(png, "image/png"), {
    valid: true,
    contentType: "image/png",
    extension: "png",
  });
  assert.deepEqual(validateAvatar(jpeg, "image/jpeg"), {
    valid: true,
    contentType: "image/jpeg",
    extension: "jpg",
  });
  assert.deepEqual(validateAvatar(webp, "image/webp"), {
    valid: true,
    contentType: "image/webp",
    extension: "webp",
  });
  const maximumPng = new Uint8Array(MAX_AVATAR_BYTES);
  maximumPng.set(png);
  assert.equal(validateAvatar(maximumPng, "image/png").valid, true);
  assert.equal(validateAvatar(png, "image/jpeg").valid, false);
  assert.equal(validateAvatar(new Uint8Array(), "image/png").valid, false);
  assert.equal(validateAvatar(new Uint8Array(MAX_AVATAR_BYTES + 1), "image/png").valid, false);
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
