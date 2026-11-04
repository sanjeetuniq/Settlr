export type TransactionRange = "all" | "week" | "month" | "quarter" | "custom";

type DateRangeInput = {
  range: string;
  from?: string;
  to?: string;
  timezone: string;
};

export type TransactionDateRange = {
  startDate?: string;
  endDate?: string;
  error?: string;
};

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveTransactionDateRange(
  input: DateRangeInput,
  now = new Date(),
): TransactionDateRange {
  const range = input.range as TransactionRange;
  let timezone: string;
  try {
    timezone = new Intl.DateTimeFormat("en-US", { timeZone: input.timezone })
      .resolvedOptions().timeZone;
  } catch {
    return { error: "Choose a valid timezone and try again." };
  }

  if (!["all", "week", "month", "quarter", "custom"].includes(range)) {
    return { error: "Choose a valid transaction date filter." };
  }
  if (range === "all") return {};

  const today = localDate(now, timezone);
  if (range === "custom") {
    if (!input.from || !input.to || !isValidDate(input.from) || !isValidDate(input.to)) {
      return { error: "Enter valid start and end dates." };
    }
    if (input.from > input.to) return { error: "The start date must be on or before the end date." };
    return { startDate: input.from, endDate: addDays(input.to, 1) };
  }

  if (range === "week") {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    return { startDate: addDays(today, -((weekday + 6) % 7)), endDate: addDays(today, 1) };
  }
  if (range === "month") {
    return { startDate: `${today.slice(0, 7)}-01`, endDate: addDays(today, 1) };
  }

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3;
  const currentQuarterStart = new Date(Date.UTC(year, quarterStartMonth, 1))
    .toISOString().slice(0, 10);
  const previousQuarterStart = new Date(Date.UTC(year, quarterStartMonth - 3, 1))
    .toISOString().slice(0, 10);
  return { startDate: previousQuarterStart, endDate: currentQuarterStart };
}
