export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function parseAmountToMinorUnits(input: string): number | null {
  const value = input.trim();
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = whole * 100 + fraction;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function formatMoney(minorUnits: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

export function splitEvenly(totalMinor: number, userIds: string[]) {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor <= 0 ||
    userIds.length === 0 ||
    new Set(userIds).size !== userIds.length
  ) {
    throw new Error("A positive total and unique participants are required.");
  }

  const orderedIds = [...userIds].sort();
  const base = Math.floor(totalMinor / orderedIds.length);
  const remainder = totalMinor % orderedIds.length;

  return orderedIds.map((userId, index) => ({
    user_id: userId,
    amount_minor: base + (index < remainder ? 1 : 0),
  }));
}

export function simplifyBalances(
  balances: { user_id: string; balance_minor: number }[],
) {
  const debtors = balances
    .filter((entry) => entry.balance_minor < 0)
    .map((entry) => ({ userId: entry.user_id, amount: -entry.balance_minor }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const creditors = balances
    .filter((entry) => entry.balance_minor > 0)
    .map((entry) => ({ userId: entry.user_id, amount: entry.balance_minor }))
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const totalDebts = debtors.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCredits = creditors.reduce((sum, entry) => sum + entry.amount, 0);
  if (totalDebts !== totalCredits) {
    throw new Error("Group balances do not reconcile.");
  }

  const transfers: { from_user_id: string; to_user_id: string; amount_minor: number }[] =
    [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = Math.min(
      debtors[debtorIndex].amount,
      creditors[creditorIndex].amount,
    );

    transfers.push({
      from_user_id: debtors[debtorIndex].userId,
      to_user_id: creditors[creditorIndex].userId,
      amount_minor: amount,
    });
    debtors[debtorIndex].amount -= amount;
    creditors[creditorIndex].amount -= amount;

    if (debtors[debtorIndex].amount === 0) debtorIndex += 1;
    if (creditors[creditorIndex].amount === 0) creditorIndex += 1;
  }

  return transfers;
}
