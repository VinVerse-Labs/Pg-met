import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { ComplaintCommentVisibility } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// `visibility` is client-requested but never trusted blindly - a tenant
// requesting INTERNAL is rejected server-side
// (COMPLAINT_INTERNAL_COMMENT_FORBIDDEN), never silently downgraded to
// PUBLIC (spec: the server must "verify whether the caller can create
// INTERNAL comments").
export class CreateCommentDto {
  @ApiProperty({ example: 'The technician is scheduled for tomorrow morning.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ enum: ComplaintCommentVisibility, default: 'PUBLIC' })
  @IsOptional()
  @IsEnum(ComplaintCommentVisibility)
  visibility?: ComplaintCommentVisibility;
}
