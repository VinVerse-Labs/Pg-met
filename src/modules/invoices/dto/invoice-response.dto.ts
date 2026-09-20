import { ApiProperty } from '@nestjs/swagger';
import { Invoice, InvoiceItem, InvoiceStatus } from '@prisma/client';
import { InvoiceItemResponseDto } from './invoice-item-response.dto';

// Every monetary field is a decimal STRING (e.g. "8000.00"), never a JS
// number - see RentPlanResponseDto for the same convention and why.
export class InvoiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  invoiceNumber!: string;

  @ApiProperty()
  billingPeriodStart!: Date;

  @ApiProperty()
  billingPeriodEnd!: Date;

  @ApiProperty({ nullable: true, type: Date })
  issueDate!: Date | null;

  @ApiProperty()
  dueDate!: Date;

  @ApiProperty({ example: '8000.00' })
  subtotal!: string;

  @ApiProperty({ example: '0.00' })
  discount!: string;

  @ApiProperty({ example: '0.00' })
  tax!: string;

  @ApiProperty({ example: '8000.00' })
  total!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: InvoiceStatus })
  status!: InvoiceStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [InvoiceItemResponseDto], required: false })
  items?: InvoiceItemResponseDto[];

  static fromEntity(
    invoice: Invoice & { items?: InvoiceItem[] },
  ): InvoiceResponseDto {
    const dto = new InvoiceResponseDto();
    dto.id = invoice.id;
    dto.residencyId = invoice.residencyId;
    dto.invoiceNumber = invoice.invoiceNumber;
    dto.billingPeriodStart = invoice.billingPeriodStart;
    dto.billingPeriodEnd = invoice.billingPeriodEnd;
    dto.issueDate = invoice.issueDate;
    dto.dueDate = invoice.dueDate;
    dto.subtotal = invoice.subtotal.toString();
    dto.discount = invoice.discount.toString();
    dto.tax = invoice.tax.toString();
    dto.total = invoice.total.toString();
    dto.currency = invoice.currency;
    dto.status = invoice.status;
    dto.createdAt = invoice.createdAt;
    if (invoice.items) {
      dto.items = invoice.items.map(InvoiceItemResponseDto.fromEntity);
    }
    return dto;
  }
}
