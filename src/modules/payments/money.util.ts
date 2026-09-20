import { Prisma } from '@prisma/client';

// Exact Decimal-to-smallest-unit conversion (spec section 30) - never
// `amount * 100` with a JS float, which can misround a value like 100.50.
// `Prisma.Decimal.times`/`toDecimalPlaces` stay in exact decimal
// arithmetic all the way to the integer paise value.
export function decimalToSmallestUnit(amount: Prisma.Decimal): number {
  return amount
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function smallestUnitToDecimal(units: number): Prisma.Decimal {
  return new Prisma.Decimal(units)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
