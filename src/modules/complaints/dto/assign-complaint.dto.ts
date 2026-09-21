import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignComplaintDto {
  @ApiProperty()
  @IsUUID()
  assignedToUserId!: string;
}
