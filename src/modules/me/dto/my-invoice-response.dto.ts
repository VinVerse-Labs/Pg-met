import { ApiProperty } from '@nestjs/swagger';
import { InvoiceItemType, InvoiceStatus, PaymentStatus } from '@prisma/client';

// Every money field is a decimal STRING (e.g. "8000.00"), never a JS
// number - same convention as InvoiceResponseDto. `amountPaid` /
// `balanceDue` / `isPayable` are computed here, from PaymentAllocation,
// so a tenant client never has to derive a financial value itself.

export class MyInvoiceItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: InvoiceItemType }) itemType!: InvoiceItemType;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '8000.00' }) unitAmount!: string;
  @ApiProperty({ example: '8000.00' }) amount!: string;
}

// Tenant-safe payment shape: deliberately excludes platformFee,
// ownerSettlementAmount, settlement and organization/property ids.
export class MyPaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ example: '4000.00' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ nullable: true, type: String }) method!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Razorpay payment reference, safe to show the payer.',
  })
  providerPaymentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) failureCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) failureMessage!: string | null;
  @ApiProperty({ nullable: true, type: Date }) paidAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class MyInvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() billingPeriodStart!: Date;
  @ApiProperty() billingPeriodEnd!: Date;
  @ApiProperty({ nullable: true, type: Date }) issueDate!: Date | null;
  @ApiProperty() dueDate!: Date;
  @ApiProperty({ example: '8000.00' }) subtotal!: string;
  @ApiProperty({ example: '0.00' }) discount!: string;
  @ApiProperty({ example: '0.00' }) tax!: string;
  @ApiProperty({ example: '8000.00' }) total!: string;
  @ApiProperty({ example: '4000.00' }) amountPaid!: string;
  @ApiProperty({ example: '4000.00' }) balanceDue!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;
  @ApiProperty({
    description:
      'true when the backend would accept a payment order now (payable status and a balance left).',
  })
  isPayable!: boolean;
  @ApiProperty() propertyName!: string;
}

export class MyInvoiceDetailDto extends MyInvoiceDto {
  @ApiProperty({ type: [MyInvoiceItemDto] }) items!: MyInvoiceItemDto[];
  @ApiProperty({ type: [MyPaymentDto] }) payments!: MyPaymentDto[];
}

export class MyRentOutstandingDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ example: '12000.00' }) amount!: string;
}

export class MyRentSummaryDto {
  @ApiProperty({
    type: [MyRentOutstandingDto],
    description: 'Outstanding balance per currency across payable invoices.',
  })
  outstanding!: MyRentOutstandingDto[];
  @ApiProperty() openInvoiceCount!: number;
  @ApiProperty() overdueInvoiceCount!: number;
  @ApiProperty({
    type: MyInvoiceDto,
    nullable: true,
    description: 'The payable invoice with the earliest due date.',
  })
  nextDue!: MyInvoiceDto | null;
}
