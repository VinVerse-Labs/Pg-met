import { Injectable } from '@nestjs/common';
import {
  NotificationProvider,
  NotificationProviderInput,
  NotificationProviderResult,
} from './notification-provider.interface';

// IN_APP "delivery" means the Notification row itself exists for the user
// (spec section 16) - there is nothing external to call, so this always
// succeeds once invoked. NotificationDeliveryService still records a real
// NotificationDelivery row for IN_APP (never skips creating one) so the
// per-channel delivery model stays uniform across all five channels.
@Injectable()
export class InAppNotificationProvider implements NotificationProvider {
  readonly providerName = 'IN_APP';

  async send(
    input: NotificationProviderInput,
  ): Promise<NotificationProviderResult> {
    return {
      status: 'SENT',
      providerMessageId: `in-app:${input.userId}`,
    };
  }
}
