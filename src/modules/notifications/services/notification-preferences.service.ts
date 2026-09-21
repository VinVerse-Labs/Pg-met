import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MANDATORY_CHANNEL } from '../enums/notification-type.enum';
import { UpdateNotificationPreferencesDto } from '../dto/update-notification-preferences.dto';
import { NotificationPreferenceResponseDto } from '../dto/notification-preference-response.dto';

// Sensible defaults (spec section 21) applied whenever no explicit
// NotificationPreference row exists yet - the user is never required to
// configure every (type, channel) pair manually. PUSH's default is
// additionally gated on the user actually having an active PushDevice
// (checked by NotificationDeliveryService at send time, not here) -
// "enabled by default" here just means "not explicitly opted out."
const DEFAULT_ENABLED: Record<NotificationChannel, boolean> = {
  IN_APP: true,
  PUSH: true,
  EMAIL: false,
  WHATSAPP: false,
  SMS: false,
};

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async findForUser(
    user: AuthenticatedUser,
  ): Promise<NotificationPreferenceResponseDto[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: user.id },
      orderBy: [{ notificationType: 'asc' }, { channel: 'asc' }],
    });
    return rows.map(NotificationPreferenceResponseDto.fromEntity);
  }

  // Full upsert of the caller's own preferences only - never accepts a
  // userId from the client (spec section 24/65). Rejects any attempt to
  // disable the one mandatory channel (spec section 22/51) before writing
  // anything, so a request that fails validation never partially applies.
  async update(
    user: AuthenticatedUser,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceResponseDto[]> {
    const invalidMandatory = dto.preferences.some(
      (p) => p.channel === MANDATORY_CHANNEL && p.enabled === false,
    );
    if (invalidMandatory) {
      throw new AppException(
        ErrorCode.NOTIFICATION_MANDATORY_TYPE,
        `The ${MANDATORY_CHANNEL} channel cannot be disabled.`,
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction(
      dto.preferences.map((p) =>
        this.prisma.notificationPreference.upsert({
          where: {
            notification_preferences_user_type_channel_unique: {
              userId: user.id,
              notificationType: p.notificationType,
              channel: p.channel,
            },
          },
          create: {
            userId: user.id,
            notificationType: p.notificationType,
            channel: p.channel,
            enabled: p.enabled,
          },
          update: { enabled: p.enabled },
        }),
      ),
    );
    return this.findForUser(user);
  }

  // The one place "is this (type, channel) actually enabled for this
  // user" is decided - falls back to DEFAULT_ENABLED when no explicit row
  // exists, and always reports the mandatory channel as enabled
  // regardless of any stored row (defense in depth alongside `update`'s
  // own rejection of an attempt to disable it).
  async isChannelEnabled(
    userId: string,
    notificationType: string,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (channel === MANDATORY_CHANNEL) {
      return true;
    }
    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        notification_preferences_user_type_channel_unique: {
          userId,
          notificationType,
          channel,
        },
      },
    });
    return preference?.enabled ?? DEFAULT_ENABLED[channel];
  }
}
