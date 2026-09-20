import { ApiProperty } from '@nestjs/swagger';
import { OwnerSettlement, SettlementStatus } from '@prisma/client';

// Deliberately a summary, not the full OwnerSettlement row - exposed
// nested inside PaymentResponseDto rather than through a separate
// endpoint (spec section 45: "settlement information can be exposed
// through payment/invoice APIs rather than creating unnecessary
// endpoints").
export class OwnerSettlementSummaryDto {
  @ApiProperty({ enum: SettlementStatus })
  status!: SettlementStatus;

  @ApiProperty({ example: '9999.00' })
  settlementAmount!: string;

  @ApiProperty({ example: '1.00' })
  platformFee!: string;

  @ApiProperty({ nullable: true, type: Date })
  settledAt!: Date | null;

  static fromEntity(settlement: OwnerSettlement): OwnerSettlementSummaryDto {
    const dto = new OwnerSettlementSummaryDto();
    dto.status = settlement.status;
    dto.settlementAmount = settlement.settlementAmount.toString();
    dto.platformFee = settlement.platformFee.toString();
    dto.settledAt = settlement.settledAt;
    return dto;
  }
}
