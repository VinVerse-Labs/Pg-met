import { Prisma } from '@prisma/client';

// Pure, deterministic proration math - no I/O, no Prisma calls - kept
// separate from InvoicesService so the formula and its edge cases (first
// day, last day, February, leap years, mid-month checkout) can be unit
// tested directly without mocking a database.
//
// Convention (must be documented, per spec section 15): `periodStart`,
// `periodEnd`, `occupiedStart`, `occupiedEnd` are all INCLUSIVE calendar
// days - "days in period" for January 1-31 is 31, not 30 or 32. All dates
// are treated as UTC midnight boundaries (consistent with how
// InvoicesService constructs billing-period boundaries) so no timezone
// ever shifts a day count by one.
//
// Rounding: Decimal, 2 decimal places, ROUND_HALF_UP - the conventional
// rule for INR currency amounts (never "round half to even"/banker's
// rounding, which would be surprising on an invoice).
export interface ProrationInput {
  monthlyAmount: Prisma.Decimal;
  periodStart: Date;
  periodEnd: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function inclusiveDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

// Returns 0 if there is no overlap at all (occupiedEnd < occupiedStart) -
// callers must treat that as "this residency was not present during this
// billing period at all" and reject generating an invoice, not silently
// bill zero.
export function calculateProratedAmount(input: ProrationInput): Prisma.Decimal {
  const { monthlyAmount, periodStart, periodEnd, occupiedStart, occupiedEnd } =
    input;

  if (occupiedEnd < occupiedStart) {
    return new Prisma.Decimal(0);
  }

  const daysInPeriod = inclusiveDayCount(periodStart, periodEnd);
  const occupiedDays = inclusiveDayCount(occupiedStart, occupiedEnd);

  // Full-period occupancy short-circuits to the exact monthly amount -
  // avoids ever showing a rounding artifact (e.g. 8000.00 becoming
  // 7999.99 or 8000.01) on the overwhelmingly common case of a resident
  // who stayed the entire billing period.
  if (occupiedDays >= daysInPeriod) {
    return monthlyAmount;
  }

  return monthlyAmount
    .times(occupiedDays)
    .dividedBy(daysInPeriod)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export { inclusiveDayCount };
