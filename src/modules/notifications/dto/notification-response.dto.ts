import { ApiProperty } from '@nestjs/swagger';
import { Notification, NotificationPriority } from '@prisma/client';

// Deliberately never includes delivery internals (spec section 83:
// "normal /me/notifications should NOT expose providerMessageId, provider
// errors, internal retry counts, provider secrets") - the mobile client
// only ever needs notification content, not how it was delivered.
export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: NotificationPriority })
  priority!: NotificationPriority;

  @ApiProperty({ type: Object, nullable: true })
  data!: Record<string, unknown> | null;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ nullable: true, type: Date })
  readAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(entity: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = entity.id;
    dto.type = entity.type;
    dto.title = entity.title;
    dto.body = entity.body;
    dto.priority = entity.priority;
    dto.data = (entity.data as Record<string, unknown> | null) ?? null;
    dto.isRead = entity.status === 'READ';
    dto.readAt = entity.readAt;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}
