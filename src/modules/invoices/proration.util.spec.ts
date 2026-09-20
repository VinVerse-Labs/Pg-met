import { Prisma } from '@prisma/client';
import { calculateProratedAmount, inclusiveDayCount } from './proration.util';

const utc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d));

describe('calculateProratedAmount', () => {
  it('returns the exact monthly amount for a full-period stay (no rounding drift)', () => {
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('8000.00'),
      periodStart: utc(2027, 1, 1),
      periodEnd: utc(2027, 1, 31),
      occupiedStart: utc(2027, 1, 1),
      occupiedEnd: utc(2027, 1, 31),
    });
    expect(result.toString()).toBe('8000');
  });

  it('prorates a resident starting mid-month (Jan 18, 31-day month)', () => {
    // Occupied Jan 18-31 inclusive = 14 days out of 31.
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('9000.00'),
      periodStart: utc(2027, 1, 1),
      periodEnd: utc(2027, 1, 31),
      occupiedStart: utc(2027, 1, 18),
      occupiedEnd: utc(2027, 1, 31),
    });
    // 9000 * 14 / 31 = 4064.516... -> rounds to 4064.52
    expect(result.toString()).toBe('4064.52');
  });

  it('handles occupancy starting on the first day of the month (full period)', () => {
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('9000.00'),
      periodStart: utc(2027, 1, 1),
      periodEnd: utc(2027, 1, 31),
      occupiedStart: utc(2027, 1, 1),
      occupiedEnd: utc(2027, 1, 31),
    });
    expect(result.toString()).toBe('9000');
  });

  it('handles occupancy ending on the last day of the month (checkout on last day = full period)', () => {
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('9000.00'),
      periodStart: utc(2027, 1, 1),
      periodEnd: utc(2027, 1, 31),
      occupiedStart: utc(2027, 1, 1),
      occupiedEnd: utc(2027, 1, 31),
    });
    expect(result.toString()).toBe('9000');
  });

  it('prorates a mid-month checkout', () => {
    // Occupied Feb 1-10 inclusive = 10 days out of 28 (2027 is not a leap year).
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('8000.00'),
      periodStart: utc(2027, 2, 1),
      periodEnd: utc(2027, 2, 28),
      occupiedStart: utc(2027, 2, 1),
      occupiedEnd: utc(2027, 2, 10),
    });
    // 8000 * 10 / 28 = 2857.142857... -> rounds to 2857.14
    expect(result.toString()).toBe('2857.14');
  });

  it('handles February in a non-leap year (28 days)', () => {
    expect(inclusiveDayCount(utc(2027, 2, 1), utc(2027, 2, 28))).toBe(28);
  });

  it('handles February in a leap year (29 days)', () => {
    expect(inclusiveDayCount(utc(2028, 2, 1), utc(2028, 2, 29))).toBe(29);
  });

  it('returns zero when there is no overlap between occupied and period ranges', () => {
    const result = calculateProratedAmount({
      monthlyAmount: new Prisma.Decimal('8000.00'),
      periodStart: utc(2027, 1, 1),
      periodEnd: utc(2027, 1, 31),
      occupiedStart: utc(2027, 2, 1),
      occupiedEnd: utc(2027, 1, 15), // end before start - no overlap
    });
    expect(result.toString()).toBe('0');
  });
});

describe('inclusiveDayCount', () => {
  it('counts a single day as 1, not 0', () => {
    expect(inclusiveDayCount(utc(2027, 1, 1), utc(2027, 1, 1))).toBe(1);
  });

  it('counts a full 31-day month correctly', () => {
    expect(inclusiveDayCount(utc(2027, 1, 1), utc(2027, 1, 31))).toBe(31);
  });
});
