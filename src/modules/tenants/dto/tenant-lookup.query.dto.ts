import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TenantLookupQueryDto {
  @ApiProperty({ example: 'TN-3K7Q-9XZ2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;
}
