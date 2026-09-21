import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResolveComplaintDto {
  @ApiProperty({ example: 'Plumber replaced the washer; verified no leak.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolutionNote!: string;
}
