// Calendar-aware month arithmetic for the SaaS subscription's rolling
// billing period (spec: "currentPeriodStart = 2026-09-20, currentPeriodEnd
// = 2026-10-19" - one month later, minus a day, never a fixed millisecond
// count). Uses the same `Date.UTC` idiom as Phase 5's billing-period.util
// so month-end edge cases (Jan 31 -> Feb 28/29) clamp instead of
// overflowing into the wrong month.

export function addOneCalendarMonthUtc(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  // Day 0 of "two months ahead" is the last day of "one month ahead" -
  // the same trick Phase 5's computeMonthlyBillingPeriod uses for "last
  // day of this month".
  const lastDayOfTargetMonth = new Date(
    Date.UTC(year, month + 2, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(
    Date.UTC(
      year,
      month + 1,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export interface SubscriptionPeriod {
  periodStart: Date;
  periodEnd: Date;
}

// The next rolling monthly period starting the day after `previousEnd` -
// inclusive on both ends, e.g. previousEnd = Sep 19 -> [Sep 20, Oct 19].
export function computeNextSubscriptionPeriod(
  previousEnd: Date,
): SubscriptionPeriod {
  const periodStart = addDaysUtc(previousEnd, 1);
  const periodEnd = addDaysUtc(addOneCalendarMonthUtc(periodStart), -1);
  return { periodStart, periodEnd };
}
