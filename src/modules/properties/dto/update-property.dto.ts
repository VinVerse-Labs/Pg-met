import { IsIanaTimeZone } from '../../../common/validation/calendar';
import { ApiProperty } from '@nestjs/swagger';
import { PropertyType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// No organizationId here - moving a property to a different organization
// is not a supported operation in Phase 2 (it isn't requested, and doing
// it safely would need its own audit/authorization story). No `status`
// either: archiving goes through the dedicated DELETE endpoint
// (PropertiesService.archive), not a generic field update, so it's always
// a deliberate, logged action rather than a side effect of an unrelated
// PATCH.
export class UpdatePropertyDto {
  @ApiProperty({ required: false, minLength: 2, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiProperty({ enum: PropertyType, required: false })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  addressLine1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(12)
  postalCode?: string;

  @ApiProperty({
    required: false,
    example: 'Asia/Kolkata',
    description:
      'IANA timezone the property operates in; drives "today" for menus. Defaults to Asia/Kolkata.',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}
