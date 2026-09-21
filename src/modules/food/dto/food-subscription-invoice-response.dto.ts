import { ApiProperty } from '@nestjs/swagger';
import {
  FoodSubscriptionInvoice,
  FoodSubscriptionInvoiceStatus,
} from '@prisma/client';

export class FoodSubscriptionInvoiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  foodSubscriptionId!: string;

  @ApiProperty()
  invoiceNumber!: string;

  @ApiProperty()
  billingPeriodStart!: Date;

  @ApiProperty()
  billingPeriodEnd!: Date;

  @ApiProperty()
  subtotal!: string;

  @ApiProperty()
  tax!: string;

  @ApiProperty()
  total!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: FoodSubscriptionInvoiceStatus })
  status!: FoodSubscriptionInvoiceStatus;

  @ApiProperty({ nullable: true, type: Date })
  issuedAt!: Date | null;

  @ApiProperty()
  dueAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  paidAt!: Date | null;

  static fromEntity(
    entity: FoodSubscriptionInvoice,
  ): FoodSubscriptionInvoiceResponseDto {
    const dto = new FoodSubscriptionInvoiceResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.tenantId = entity.tenantId;
    dto.residencyId = entity.residencyId;
    dto.foodSubscriptionId = entity.foodSubscriptionId;
    dto.invoiceNumber = entity.invoiceNumber;
    dto.billingPeriodStart = entity.billingPeriodStart;
    dto.billingPeriodEnd = entity.billingPeriodEnd;
    dto.subtotal = entity.subtotal.toString();
    dto.tax = entity.tax.toString();
    dto.total = entity.total.toString();
    dto.currency = entity.currency;
    dto.status = entity.status;
    dto.issuedAt = entity.issuedAt;
    dto.dueAt = entity.dueAt;
    dto.paidAt = entity.paidAt;
    return dto;
  }
}
