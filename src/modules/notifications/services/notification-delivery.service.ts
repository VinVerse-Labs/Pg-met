import { Inject, Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  EMAIL_PROVIDER,
  IN_APP_PROVIDER,
  NotificationProvider,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  WHATSAPP_PROVIDER,
} from '../providers/notification-provider.interface';

const ALL_CHANNELS: NotificationChannel[] = [
  'IN_APP',
  'PUSH',
  'EMAIL',
  'WHATSAPP',
  'SMS',
];

// Channel preference resolution (spec section 50): for every channel,
// decide enabled -> deliver, disabled -> SKIPPED, PUSH additionally
// requires an active PushDevice regardless of preference (nowhere to
// push to otherwise). A provider failure here is always caught and
// recorded as a FAILED delivery row - it never propagates back to
// NotificationsService.publish, which is what makes a notification-layer
// failure incapable of affecting the business operation that triggered it
// (spec section 45/77/106).
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    @Inject(IN_APP_PROVIDER)
    private readonly inAppProvider: NotificationProvider,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: NotificationProvider,
    @Inject(EMAIL_PROVIDER)
    private readonly emailProvider: NotificationProvider,
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsappProvider: NotificationProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
  ) {}

  async deliverAll(notification: Notification): Promise<void> {
    for (const channel of ALL_CHANNELS) {
      try {
        await this.deliverChannel(notification, channel);
      } catch (error) {
        // A provider throwing outright (rather than returning a FAILED
        // result) must still never escape to the caller - log and move
        // on to the next channel.
        this.logger.error(
          `NOTIFICATION_DELIVERY_UNEXPECTED_ERROR notification=${notification.id} channel=${channel} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async deliverChannel(
    notification: Notification,
    channel: NotificationChannel,
  ): Promise<void> {
    const enabled = await this.preferences.isChannelEnabled(
      notification.userId,
      notification.type,
      channel,
    );
    if (!enabled) {
      await this.recordDelivery(notification.id, channel, {
        provider: 'NONE',
        status: 'SKIPPED',
        failureReason: 'Channel disabled by user preference.',
      });
      return;
    }

    if (channel === 'PUSH') {
      const hasDevice = await this.prisma.pushDevice.findFirst({
        where: { userId: notification.userId, isActive: true },
        select: { id: true },
      });
      if (!hasDevice) {
        await this.recordDelivery(notification.id, channel, {
          provider: 'NONE',
          status: 'SKIPPED',
          failureReason: 'No active push device registered.',
        });
        return;
      }
    }

    const provider = this.providerFor(channel);
    const result = await provider.send({
      userId: notification.userId,
      channel,
      title: notification.title,
      body: notification.body,
      data: (notification.data as Record<string, unknown>) ?? undefined,
    });

    await this.recordDelivery(notification.id, channel, {
      provider: provider.providerName,
      status: result.status,
      providerMessageId: result.providerMessageId,
      failureReason: result.failureReason,
    });
  }

  private providerFor(channel: NotificationChannel): NotificationProvider {
    switch (channel) {
      case 'IN_APP':
        return this.inAppProvider;
      case 'PUSH':
        return this.pushProvider;
      case 'EMAIL':
        return this.emailProvider;
      case 'WHATSAPP':
        return this.whatsappProvider;
      case 'SMS':
        return this.smsProvider;
    }
  }

  // One delivery row per (notification, channel) - upserted, never
  // inserted afresh per attempt (spec section 14/60's own uniqueness
  // requirement), with `attemptCount` incremented in place.
  private async recordDelivery(
    notificationId: string,
    channel: NotificationChannel,
    result: {
      provider: string;
      status: 'SENT' | 'FAILED' | 'SKIPPED';
      providerMessageId?: string;
      failureReason?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.notificationDelivery.findUnique({
      where: {
        notification_deliveries_notification_channel_unique: {
          notificationId,
          channel,
        },
      },
    });
    const data = {
      provider: result.provider,
      status: result.status,
      providerMessageId: result.providerMessageId ?? null,
      lastAttemptAt: now,
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      deliveredAt:
        result.status === 'SENT' ? now : (existing?.deliveredAt ?? null),
      failedAt: result.status === 'FAILED' ? now : null,
      failureReason: result.failureReason ?? null,
    };
    await this.prisma.notificationDelivery.upsert({
      where: {
        notification_deliveries_notification_channel_unique: {
          notificationId,
          channel,
        },
      },
      create: { notificationId, channel, ...data },
      update: data,
    });
  }
}
