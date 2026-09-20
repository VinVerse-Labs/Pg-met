import { ApiProperty } from '@nestjs/swagger';
import { OwnerSettlement, Payment, PaymentStatus } from '@prisma/client';
import { OwnerSettlementSummaryDto } from './owner-settlement-summary.dto';

// Every monetary field is a decimal STRING, never a JS number - same
// convention as InvoiceResponseDto/RentPlanResponseDto. `amount` is
// always the gross amount the tenant was charged (spec section 17) -
// `platformFee`/`ownerSettlementAmount` are the explicit breakdown, never
// silently subtracted from `amount`.
export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  invoiceId!: string;

  @ApiProperty()
  payerUserId!: string;

  @ApiProperty({ example: '4000.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ example: '1.00' })
  platformFee!: string;

  @ApiProperty({ example: '3999.00' })
  ownerSettlementAmount!: string;

  @ApiProperty({ nullable: true, type: String })
  method!: string | null;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ nullable: true, type: String })
  providerOrderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  providerPaymentId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failureCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failureMessage!: string | null;

  @ApiProperty({ nullable: true, type: Date })
  paidAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: OwnerSettlementSummaryDto, required: false })
  settlement?: OwnerSettlementSummaryDto;

  static fromEntity(
    payment: Payment & { settlement?: OwnerSettlement | null },
  ): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = payment.id;
    dto.organizationId = payment.organizationId;
    dto.propertyId = payment.propertyId;
    dto.residencyId = payment.residencyId;
    dto.invoiceId = payment.invoiceId;
    dto.payerUserId = payment.payerUserId;
    dto.amount = payment.amount.toString();
    dto.currency = payment.currency;
    dto.platformFee = payment.platformFee.toString();
    dto.ownerSettlementAmount = payment.ownerSettlementAmount.toString();
    dto.method = payment.method;
    dto.status = payment.status;
    dto.provider = payment.provider;
    dto.providerOrderId = payment.providerOrderId;
    dto.providerPaymentId = payment.providerPaymentId;
    dto.failureCode = payment.failureCode;
    dto.failureMessage = payment.failureMessage;
    dto.paidAt = payment.paidAt;
    dto.createdAt = payment.createdAt;
    if (payment.settlement) {
      dto.settlement = OwnerSettlementSummaryDto.fromEntity(payment.settlement);
    }
    return dto;
  }
}
