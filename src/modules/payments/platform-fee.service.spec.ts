import { Prisma } from '@prisma/client';
import { PlatformFeeService } from './platform-fee.service';

describe('PlatformFeeService', () => {
  let service: PlatformFeeService;
  let prisma: { platformFeeRule: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { platformFeeRule: { findFirst: jest.fn() } };
    service = new PlatformFeeService(prisma as any);
  });

  it('returns the active FIXED rule amount for a gross payment larger than the fee', async () => {
    prisma.platformFeeRule.findFirst.mockResolvedValue({
      feeType: 'FIXED',
      amount: new Prisma.Decimal('1.00'),
      isActive: true,
    });

    const fee = await service.calculateFee(new Prisma.Decimal('10000.00'));
    expect(fee.toString()).toBe('1');
  });

  it('applies the same fixed fee regardless of the gross amount, as long as it is smaller', async () => {
    prisma.platformFeeRule.findFirst.mockResolvedValue({
      feeType: 'FIXED',
      amount: new Prisma.Decimal('1.00'),
      isActive: true,
    });

    const feeSmall = await service.calculateFee(new Prisma.Decimal('8000.00'));
    const feeLarge = await service.calculateFee(new Prisma.Decimal('12000.00'));
    expect(feeSmall.toString()).toBe('1');
    expect(feeLarge.toString()).toBe('1');
  });

  it('never lets the fee exceed the gross amount (never make settlement negative)', async () => {
    prisma.platformFeeRule.findFirst.mockResolvedValue({
      feeType: 'FIXED',
      amount: new Prisma.Decimal('1.00'),
      isActive: true,
    });

    const fee = await service.calculateFee(new Prisma.Decimal('0.50'));
    expect(fee.toString()).toBe('0.5');
  });

  it('returns zero when no active fee rule exists', async () => {
    prisma.platformFeeRule.findFirst.mockResolvedValue(null);

    const fee = await service.calculateFee(new Prisma.Decimal('10000.00'));
    expect(fee.toString()).toBe('0');
  });
});
