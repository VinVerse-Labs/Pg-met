import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ApplicationStatus, RoomType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ enum: RoomType })
  @IsOptional()
  @IsEnum(RoomType)
  preferredRoomType?: RoomType;

  @ApiPropertyOptional() @IsOptional() @IsDateString() createdFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() createdTo?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  preferredMoveInFrom?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  preferredMoveInTo?: string;
}
