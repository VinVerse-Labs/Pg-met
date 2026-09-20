// Pure calendar-math helpers, kept separate from InvoicesService for the
// same reason as proration.util.ts - directly unit-testable without a
// database. All dates are constructed via `Date.UTC` and read back via
// the `getUTC*` accessors exclusively, so the host machine's local
// timezone can never shift a billing period's day boundaries by one -
// spec section 14's "use correct calendar calculations" requirement.

export interface BillingPeriod {
  periodStart: Date;
  periodEnd: Date;
}

// `Date.UTC(year, month, 0)` is the well-known JS idiom for "the last day
// of the *previous* zero-indexed month" - passing the 1-indexed `month`
// here (not `month - 1`) lands exactly on the last day of the requested
// month, correctly accounting for 28/29/30/31-day months and leap years
// without any hardcoded day-count table.
export function computeMonthlyBillingPeriod(
  year: number,
  month: number,
): BillingPeriod {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  return { periodStart, periodEnd };
}

// dueDay=31 in a month with fewer days (e.g. February) deterministically
// falls back to that month's actual last day - spec section 19's required
// documented rule, rather than overflowing into the next month (which is
// what `new Date(Date.UTC(year, month - 1, 31))` would silently do for
// February).
export function computeDueDate(
  year: number,
  month: number,
  dueDay: number,
): Date {
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(dueDay, lastDayOfMonth);
  return new Date(Date.UTC(year, month - 1, clampedDay));
}
