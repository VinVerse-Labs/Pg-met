import { ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// Tenant list filters: only what a tenant needs. No property/room/assignee
// filters - the set is already pinned to the caller's own complaints.
export class ListMyComplaintsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;
}
