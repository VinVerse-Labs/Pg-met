import {
  computeDueDate,
  computeMonthlyBillingPeriod,
} from './billing-period.util';

describe('computeMonthlyBillingPeriod', () => {
  it('computes a standard 31-day month', () => {
    const { periodStart, periodEnd } = computeMonthlyBillingPeriod(2027, 1);
    expect(periodStart.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });

  it('computes February in a non-leap year as 28 days', () => {
    const { periodEnd } = computeMonthlyBillingPeriod(2027, 2);
    expect(periodEnd.getUTCDate()).toBe(28);
  });

  it('computes February in a leap year as 29 days', () => {
    const { periodEnd } = computeMonthlyBillingPeriod(2028, 2);
    expect(periodEnd.getUTCDate()).toBe(29);
  });

  it('computes a 30-day month (April) correctly', () => {
    const { periodEnd } = computeMonthlyBillingPeriod(2027, 4);
    expect(periodEnd.getUTCDate()).toBe(30);
  });

  it('computes December correctly (year boundary)', () => {
    const { periodStart, periodEnd } = computeMonthlyBillingPeriod(2027, 12);
    expect(periodStart.toISOString()).toBe('2027-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2027-12-31T00:00:00.000Z');
  });
});

describe('computeDueDate', () => {
  it('uses the configured day when it exists in the month', () => {
    const dueDate = computeDueDate(2027, 1, 5);
    expect(dueDate.toISOString()).toBe('2027-01-05T00:00:00.000Z');
  });

  it('falls back to the last day of the month when dueDay=31 in a shorter month', () => {
    const dueDate = computeDueDate(2027, 2, 31);
    expect(dueDate.getUTCDate()).toBe(28);
  });

  it('falls back to Feb 29 in a leap year when dueDay=31', () => {
    const dueDate = computeDueDate(2028, 2, 31);
    expect(dueDate.getUTCDate()).toBe(29);
  });

  it('does not fall back when the day exists (30-day month, dueDay=30)', () => {
    const dueDate = computeDueDate(2027, 4, 30);
    expect(dueDate.getUTCDate()).toBe(30);
  });
});
