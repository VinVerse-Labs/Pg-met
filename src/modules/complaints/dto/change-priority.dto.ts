import { ApiProperty } from '@nestjs/swagger';
import { ComplaintPriority } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangePriorityDto {
  @ApiProperty({ enum: ComplaintPriority })
  @IsEnum(ComplaintPriority)
  priority!: ComplaintPriority;
}
