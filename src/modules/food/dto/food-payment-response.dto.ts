import { ApiProperty } from '@nestjs/swagger';
import {
  FoodSubscriptionPayment,
  FoodSubscriptionPaymentStatus,
} from '@prisma/client';

// No platformFee/ownerSettlementAmount field - food payments are never
// split, and never feed Phase 6's OwnerSettlement (spec section 46).
export class FoodPaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  foodSubscriptionId!: string;

  @ApiProperty()
  foodSubscriptionInvoiceId!: string;

  @ApiProperty({ example: '2500.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ enum: FoodSubscriptionPaymentStatus })
  status!: FoodSubscriptionPaymentStatus;

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

  static fromEntity(payment: FoodSubscriptionPayment): FoodPaymentResponseDto {
    const dto = new FoodPaymentResponseDto();
    dto.id = payment.id;
    dto.organizationId = payment.organizationId;
    dto.foodSubscriptionId = payment.foodSubscriptionId;
    dto.foodSubscriptionInvoiceId = payment.foodSubscriptionInvoiceId;
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
