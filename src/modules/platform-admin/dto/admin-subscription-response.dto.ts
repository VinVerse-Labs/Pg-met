import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';

export class AdminSubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  planName!: string;

  @ApiProperty({ example: '499.00' })
  amount!: string;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty()
  currentPeriodStart!: Date;

  @ApiProperty()
  currentPeriodEnd!: Date;

  @ApiProperty()
  nextBillingAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  gracePeriodEndsAt!: Date | null;

  @ApiProperty({ nullable: true, type: String })
  lastPaymentStatus!: string | null;

  @ApiProperty({ nullable: true, type: String })
  outstandingInvoiceTotal!: string | null;
}
