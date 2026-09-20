import { ApiProperty } from '@nestjs/swagger';
import { BedStatus } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// `status` intentionally only accepts AVAILABLE/INACTIVE here, never
// ARCHIVED - archiving is a deliberate, separately-logged action via
// DELETE (BedsService.archive), not a value a PATCH can set. This is what
// prevents a PATCH from ever accidentally reviving an archived bed (spec
// edge case: "archived bed cannot be modified back accidentally").
export class UpdateBedDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  bedNumber?: string;

  @ApiProperty({ enum: ['AVAILABLE', 'INACTIVE'], required: false })
  @IsOptional()
  @IsIn(['AVAILABLE', 'INACTIVE'] satisfies BedStatus[])
  status?: 'AVAILABLE' | 'INACTIVE';
}
