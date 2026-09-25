import { ApiProperty } from '@nestjs/swagger';
import { RoomAmenity, RoomType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DECIMAL_PATTERN } from '../../../common/validation/decimal';

// No propertyId field - it comes from the URL (POST
// /properties/:propertyId/rooms), never from the request body, so there is
// no organizationId-style field a client could point at an org they don't
// belong to (see RoomsService for how :propertyId itself is verified).
export class CreateRoomDto {
  @ApiProperty({
    description:
      'A string, not a number - real numbering ("A-101", "DORM-1", "G01") is not purely numeric. Unique within the property, not globally.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  roomNumber!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  floor?: number;

  @ApiProperty({ enum: RoomType })
  @IsEnum(RoomType)
  roomType!: RoomType;

  @ApiProperty({
    minimum: 1,
    maximum: 50,
    description: 'Maximum number of beds this room may hold.',
  })
  @IsInt()
  @Min(1)
  @Max(50)
  capacity!: number;

  @ApiProperty({
    required: false,
    example: '7000.00',
    description:
      'Advertised monthly price per bed, decimal string (max 2 dp). Informational only - a tenant is billed by their own RentPlan.',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message:
      'pricePerBed must be a decimal string with at most 2 decimal places',
  })
  pricePerBed?: string;

  @ApiProperty({ enum: RoomAmenity, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsEnum(RoomAmenity, { each: true })
  amenities?: RoomAmenity[];

  @ApiProperty({
    required: false,
    description: 'Externally hosted http(s) image URL.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  imageUrl?: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
