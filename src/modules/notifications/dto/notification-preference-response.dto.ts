import { ApiProperty } from '@nestjs/swagger';
import { NotificationChannel, NotificationPreference } from '@prisma/client';

export class NotificationPreferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  notificationType!: string;

  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty()
  enabled!: boolean;

  static fromEntity(
    entity: NotificationPreference,
  ): NotificationPreferenceResponseDto {
    const dto = new NotificationPreferenceResponseDto();
    dto.id = entity.id;
    dto.notificationType = entity.notificationType;
    dto.channel = entity.channel;
    dto.enabled = entity.enabled;
    return dto;
  }
}
