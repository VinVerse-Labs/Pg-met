import { Prisma } from '@prisma/client';
import { decimalToSmallestUnit, smallestUnitToDecimal } from './money.util';

describe('decimalToSmallestUnit', () => {
  it('converts a whole-rupee amount exactly', () => {
    expect(decimalToSmallestUnit(new Prisma.Decimal('100.00'))).toBe(10000);
  });

  it('converts an amount with paise exactly (no float drift)', () => {
    expect(decimalToSmallestUnit(new Prisma.Decimal('100.50'))).toBe(10050);
  });

  it('converts a value that would misround under naive float multiplication', () => {
    // 0.29 * 100 in raw JS floats is 28.999999999999996, not 29.
    expect(decimalToSmallestUnit(new Prisma.Decimal('0.29'))).toBe(29);
  });
});

describe('smallestUnitToDecimal', () => {
  it('round-trips exactly', () => {
    expect(smallestUnitToDecimal(10050).toString()).toBe('100.5');
  });

  it('converts paise back to a 2-decimal rupee amount', () => {
    expect(smallestUnitToDecimal(1).toString()).toBe('0.01');
  });
});
