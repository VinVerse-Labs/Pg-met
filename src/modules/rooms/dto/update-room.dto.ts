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

// No `status` field - archiving is a deliberate, separately-logged action
// via DELETE (RoomsService.archive), never a side effect of an unrelated
// PATCH. Same convention as UpdatePropertyDto in Phase 2.
export class UpdateRoomDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  roomNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  floor?: number;

  @ApiProperty({ enum: RoomType, required: false })
  @IsOptional()
  @IsEnum(RoomType)
  roomType?: RoomType;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 50,
    description:
      'Rejected if lower than the current number of non-archived beds in the room - see RoomsService.update.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @ApiProperty({
    required: false,
    nullable: true,
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
  pricePerBed?: string | null;

  @ApiProperty({ enum: RoomAmenity, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsEnum(RoomAmenity, { each: true })
  amenities?: RoomAmenity[];

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Externally hosted http(s) image URL. null removes it.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}
