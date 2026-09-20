import { ApiProperty } from '@nestjs/swagger';
import { InvoiceItem, InvoiceItemType } from '@prisma/client';

export class InvoiceItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: InvoiceItemType })
  itemType!: InvoiceItemType;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ example: '8000.00' })
  unitAmount!: string;

  @ApiProperty({ example: '8000.00' })
  amount!: string;

  static fromEntity(item: InvoiceItem): InvoiceItemResponseDto {
    const dto = new InvoiceItemResponseDto();
    dto.id = item.id;
    dto.description = item.description;
    dto.itemType = item.itemType;
    dto.quantity = item.quantity;
    dto.unitAmount = item.unitAmount.toString();
    dto.amount = item.amount.toString();
    return dto;
  }
}
