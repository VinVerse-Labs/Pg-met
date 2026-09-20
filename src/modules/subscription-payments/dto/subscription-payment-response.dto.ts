import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPayment, SubscriptionPaymentStatus } from '@prisma/client';

// Every monetary field is a decimal STRING - same convention as every
// other payment response DTO. No platformFee/ownerSettlementAmount here
// (unlike Phase 6's PaymentResponseDto) - there is no third party to
// split funds with in this flow (spec: "there is no owner settlement in
// this flow").
export class SubscriptionPaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  subscriptionInvoiceId!: string;

  @ApiProperty({ example: '499.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ enum: SubscriptionPaymentStatus })
  status!: SubscriptionPaymentStatus;

  @ApiProperty({ nullable: true, type: String })
  providerOrderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  providerPaymentId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failureCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failureMessage!: string | null;

  @ApiProperty({ nullable: true, type: Date })
  capturedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    payment: SubscriptionPayment,
  ): SubscriptionPaymentResponseDto {
    const dto = new SubscriptionPaymentResponseDto();
    dto.id = payment.id;
    dto.organizationId = payment.organizationId;
    dto.subscriptionId = payment.subscriptionId;
    dto.subscriptionInvoiceId = payment.subscriptionInvoiceId;
    dto.amount = payment.amount.toString();
    dto.currency = payment.currency;
    dto.provider = payment.provider;
    dto.status = payment.status;
    dto.providerOrderId = payment.providerOrderId;
    dto.providerPaymentId = payment.providerPaymentId;
    dto.failureCode = payment.failureCode;
    dto.failureMessage = payment.failureMessage;
    dto.capturedAt = payment.capturedAt;
    dto.createdAt = payment.createdAt;
    return dto;
  }
}
