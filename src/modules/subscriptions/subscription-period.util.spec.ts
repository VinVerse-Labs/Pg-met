import {
  addDaysUtc,
  addOneCalendarMonthUtc,
  computeNextSubscriptionPeriod,
} from './subscription-period.util';

const utc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d));

describe('addOneCalendarMonthUtc', () => {
  it('adds one month for an ordinary date', () => {
    expect(addOneCalendarMonthUtc(utc(2026, 9, 20)).toISOString()).toBe(
      utc(2026, 10, 20).toISOString(),
    );
  });

  it('clamps Jan 31 -> Feb 28 in a non-leap year', () => {
    expect(addOneCalendarMonthUtc(utc(2027, 1, 31)).toISOString()).toBe(
      utc(2027, 2, 28).toISOString(),
    );
  });

  it('clamps Jan 31 -> Feb 29 in a leap year', () => {
    expect(addOneCalendarMonthUtc(utc(2028, 1, 31)).toISOString()).toBe(
      utc(2028, 2, 29).toISOString(),
    );
  });

  it('rolls over into the next year from December', () => {
    expect(addOneCalendarMonthUtc(utc(2026, 12, 15)).toISOString()).toBe(
      utc(2027, 1, 15).toISOString(),
    );
  });
});

describe('addDaysUtc', () => {
  it('adds days, rolling over a month boundary', () => {
    expect(addDaysUtc(utc(2027, 1, 28), 5).toISOString()).toBe(
      utc(2027, 2, 2).toISOString(),
    );
  });

  it('subtracts days with a negative count', () => {
    expect(addDaysUtc(utc(2027, 2, 1), -1).toISOString()).toBe(
      utc(2027, 1, 31).toISOString(),
    );
  });
});

describe('computeNextSubscriptionPeriod', () => {
  it('matches the spec example exactly (Sep 20 -> Oct 19)', () => {
    const { periodStart, periodEnd } = computeNextSubscriptionPeriod(
      utc(2026, 9, 19),
    );
    expect(periodStart.toISOString()).toBe(utc(2026, 9, 20).toISOString());
    expect(periodEnd.toISOString()).toBe(utc(2026, 10, 19).toISOString());
  });

  it('chains correctly into the following period', () => {
    const first = computeNextSubscriptionPeriod(utc(2026, 9, 19));
    const second = computeNextSubscriptionPeriod(first.periodEnd);
    expect(second.periodStart.toISOString()).toBe(
      utc(2026, 10, 20).toISOString(),
    );
    expect(second.periodEnd.toISOString()).toBe(
      utc(2026, 11, 19).toISOString(),
    );
  });

  it('handles a period start at month-end without producing an invalid date', () => {
    const { periodStart, periodEnd } = computeNextSubscriptionPeriod(
      utc(2027, 1, 30),
    );
    expect(periodStart.toISOString()).toBe(utc(2027, 1, 31).toISOString());
    // Jan 31 + 1 month clamps to Feb 28 (2027 is not a leap year), then -1 day.
    expect(periodEnd.toISOString()).toBe(utc(2027, 2, 27).toISOString());
  });
});
