import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// The single place platform-fee amounts are computed (spec section 19) -
// PaymentsService never hardcodes a fee anywhere. Reads the currently
// active PlatformFeeRule row rather than a constant, so the business rule
// (currently FIXED 1.00) can change later by inserting a new row, never a
// deployment - see PlatformFeeRule's doc comment in schema.prisma.
@Injectable()
export class PlatformFeeService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateFee(grossAmount: Prisma.Decimal): Promise<Prisma.Decimal> {
    const rule = await this.prisma.platformFeeRule.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!rule) {
      return new Prisma.Decimal(0);
    }

    // PERCENTAGE is a reserved future value (see PlatformFeeType) - not
    // implemented in Phase 6, so it is treated the same as "no rule" here
    // rather than guessing a calculation the spec never asked for.
    if (rule.feeType !== 'FIXED') {
      return new Prisma.Decimal(0);
    }

    // The fee must never make the owner's settlement negative (spec
    // section 20) - capping it at the gross amount is the one guard that
    // matters for a FIXED fee; a payment smaller than the configured fee
    // still nets the owner exactly 0, never a negative settlement.
    return Prisma.Decimal.min(rule.amount, grossAmount);
  }
}
