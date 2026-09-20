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
}
