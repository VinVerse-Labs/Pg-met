import { ApiProperty } from '@nestjs/swagger';
import { PropertyType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// organizationId is required input (the client has to say which
// organization the property belongs to), but it is NEVER trusted as an
// authorization mechanism by itself - PropertiesService independently
// verifies the authenticated caller actually holds an allowed role in
// *this* organizationId before creating anything. See "9. PROPERTY
// CREATION" in the Phase 2 spec and PropertiesService.create().
export class CreatePropertyDto {
  @ApiProperty()
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ minLength: 2, maxLength: 150 })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: PropertyType, required: false, default: 'PG' })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  addressLine1!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(12)
  postalCode!: string;
}
