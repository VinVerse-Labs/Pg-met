import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Amenity } from '@prisma/client';

// Shared body shape for create and update (PATCH /properties/:id/listing) -
// every field is optional so a partial update never forces the caller to
// resend the whole listing (spec section 11's publish-time completeness
// check, not this DTO, is what enforces required fields at publish time).
export class UpsertListingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  contactEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Indicative-only, manually set by the owner.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  startingFromPrice?: number;

  @ApiPropertyOptional({ enum: Amenity, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Amenity, { each: true })
  amenities?: Amenity[];
}
