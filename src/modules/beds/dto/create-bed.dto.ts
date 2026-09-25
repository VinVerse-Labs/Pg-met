import { ApiProperty } from '@nestjs/swagger';
import { BedBerth } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// No roomId/propertyId field - both come from the URL (POST
// /properties/:propertyId/rooms/:roomId/beds), never the body. See
// BedsService for how the full chain (bed -> room -> property ->
// organization) is verified server-side.
export class CreateBedDto {
  @ApiProperty({
    description:
      'A string, not a number ("B1", "1", "BED-A" are all valid). Unique within the room, not globally.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  bedNumber!: string;

  @ApiProperty({
    enum: BedBerth,
    required: false,
    description: 'LOWER/UPPER for bunk beds; omit for a regular bed.',
  })
  @IsOptional()
  @IsEnum(BedBerth)
  berth?: BedBerth;
}
