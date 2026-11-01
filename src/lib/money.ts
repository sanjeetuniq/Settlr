export const CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SGD",
  "HKD",
  "NZD",
] as const;
export type Currency = (typeof CURRENCIES)[number];

export function currencyMinorUnitScale(currency: string) {
  return currency === "JPY" ? 1 : 100;
}

export function formatMinorUnitsForInput(minorUnits: number, currency: string) {
  const scale = currencyMinorUnitScale(currency);
  if (scale === 1) return String(minorUnits);
  return `${Math.floor(minorUnits / scale)}.${String(minorUnits % scale).padStart(2, "0")}`;
}

export function parseAmountToMinorUnits(
  input: string,
  currency = "INR",
): number | null {
  const value = input.trim();
  const scale = currencyMinorUnitScale(currency);
  const match =
    scale === 1
      ? /^(\d{1,12})$/.exec(value)
      : /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction =
    scale === 1 ? 0 : Number((match[2] ?? "").padEnd(2, "0"));
  const amount = whole * scale + fraction;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function formatMoney(minorUnits: number, currency: string) {
  const scale = currencyMinorUnitScale(currency);
  const fractionDigits = scale === 1 ? 0 : 2;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minorUnits / scale);
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

export type BalanceTransfer = {
  from_user_id: string;
  to_user_id: string;
  amount_minor: number;
};

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

  const transfers: BalanceTransfer[] = [];
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

export type GroupBalanceTransfers = {
  group_id: string;
  group_name: string;
  currency: string;
  transfers: BalanceTransfer[];
};

export type BalanceDetail = {
  group_id: string;
  group_name: string;
  currency: string;
  counterpart_id: string;
  amount_minor: number;
};

export function getSettlementParties(
  userId: string,
  counterpartId: string,
  direction: "owe" | "owed",
) {
  return direction === "owe"
    ? { from_user_id: userId, to_user_id: counterpartId }
    : { from_user_id: counterpartId, to_user_id: userId };
}

export function getBalanceDetails(
  groups: GroupBalanceTransfers[],
  userId: string,
  direction: "owe" | "owed",
): BalanceDetail[] {
  return groups.flatMap((group) =>
    group.transfers.flatMap((transfer) => {
      const isOwed = direction === "owe"
        ? transfer.from_user_id === userId
        : transfer.to_user_id === userId;
      if (!isOwed) return [];
      return [{
        group_id: group.group_id,
        group_name: group.group_name,
        currency: group.currency,
        counterpart_id: direction === "owe"
          ? transfer.to_user_id
          : transfer.from_user_id,
        amount_minor: transfer.amount_minor,
      }];
    }),
  );
}
