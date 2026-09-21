import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PushPlatform, PushTokenProvider } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterPushDeviceDto {
  @ApiProperty({ enum: PushPlatform })
  @IsEnum(PushPlatform)
  platform!: PushPlatform;

  @ApiPropertyOptional({ enum: PushTokenProvider, default: 'EXPO' })
  @IsOptional()
  @IsEnum(PushTokenProvider)
  provider?: PushTokenProvider;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  token!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
