import { Injectable } from '@nestjs/common';
import {
  NotificationProvider,
  NotificationProviderInput,
  NotificationProviderResult,
} from './notification-provider.interface';

// The safe placeholder for every channel with no real provider configured
// yet (spec section 19/56/89: "do not integrate WhatsApp/SMS/email/FCM
// unless credentials already exist... a no-op implementation is
// acceptable"). Always reports SKIPPED, never SENT/DELIVERED - a channel
// this backend cannot actually reach must never be reported as if it
// worked (spec section 19: "do not silently mark it DELIVERED").
// PushNotificationProvider, EmailProvider, WhatsAppProvider, and
// SmsProvider are all this same class today, parametrized only by name -
// wiring a real provider for one channel later means adding a new class
// and changing that one channel's DI binding in NotificationsModule,
// never touching this one or any other channel's.
@Injectable()
export class NoopNotificationProvider implements NotificationProvider {
  constructor(readonly providerName: string) {}

  async send(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed by the NotificationProvider interface; this implementation never needs the input.
    _input: NotificationProviderInput,
  ): Promise<NotificationProviderResult> {
    return {
      status: 'SKIPPED',
      failureReason: `No ${this.providerName} provider is configured.`,
    };
  }
}
