import { ApiProperty } from '@nestjs/swagger';
import { NotificationChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class NotificationPreferenceInputDto {
  @ApiProperty({ example: 'FOOD_MENU_UPDATED' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  notificationType!: string;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

// A batch upsert, not a single-preference PATCH - the mobile settings
// screen naturally edits several (type, channel) toggles at once, and
// this keeps the whole update atomic (one $transaction, see
// NotificationPreferencesService.update).
export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceInputDto)
  preferences!: NotificationPreferenceInputDto[];
}
