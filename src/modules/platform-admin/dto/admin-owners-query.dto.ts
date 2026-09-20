import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AdminOwnersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches owner name or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
