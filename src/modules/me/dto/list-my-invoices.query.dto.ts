import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListMyInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: InvoiceStatus,
    description: 'DRAFT is never returned to a tenant.',
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}
