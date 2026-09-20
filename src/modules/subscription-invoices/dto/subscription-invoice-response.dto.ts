import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionInvoice, SubscriptionInvoiceStatus } from '@prisma/client';

// Every monetary field is a decimal STRING - same convention as every
// other invoice response DTO in this codebase (Phase 5's
// InvoiceResponseDto, Phase 6's PaymentResponseDto).
export class SubscriptionInvoiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  invoiceNumber!: string;

  @ApiProperty()
  billingPeriodStart!: Date;

  @ApiProperty()
  billingPeriodEnd!: Date;

  @ApiProperty({ example: '499.00' })
  subtotal!: string;

  @ApiProperty({ example: '0.00' })
  tax!: string;

  @ApiProperty({ example: '499.00' })
  total!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: SubscriptionInvoiceStatus })
  status!: SubscriptionInvoiceStatus;

  @ApiProperty({ nullable: true, type: Date })
  issuedAt!: Date | null;

  @ApiProperty()
  dueAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  paidAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    invoice: SubscriptionInvoice,
  ): SubscriptionInvoiceResponseDto {
    const dto = new SubscriptionInvoiceResponseDto();
    dto.id = invoice.id;
    dto.organizationId = invoice.organizationId;
    dto.subscriptionId = invoice.subscriptionId;
    dto.invoiceNumber = invoice.invoiceNumber;
    dto.billingPeriodStart = invoice.billingPeriodStart;
    dto.billingPeriodEnd = invoice.billingPeriodEnd;
    dto.subtotal = invoice.subtotal.toString();
    dto.tax = invoice.tax.toString();
    dto.total = invoice.total.toString();
    dto.currency = invoice.currency;
    dto.status = invoice.status;
    dto.issuedAt = invoice.issuedAt;
    dto.dueAt = invoice.dueAt;
    dto.paidAt = invoice.paidAt;
    dto.createdAt = invoice.createdAt;
    return dto;
  }
}
