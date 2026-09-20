import { ApiProperty } from '@nestjs/swagger';
import { RoomType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
}
