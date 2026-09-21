import { NotificationChannel } from '@prisma/client';

// The one abstraction every delivery channel implements (spec section
// 17) - NotificationDeliveryService depends on this interface only, never
// on a concrete SDK. A real FCM/APNs/SendGrid/Twilio/WhatsApp integration
// later is a new class implementing this interface plus a DI binding
// switch, never a change to any business module or to
// NotificationDeliveryService itself.
export interface NotificationProviderInput {
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Provider-specific destination (a push token, an email address, a
  // phone number) - resolved by the caller (NotificationDeliveryService),
  // never by the provider itself, so no provider needs to know how to
  // look up a user's contact details.
  destination?: string;
}

export type NotificationProviderResultStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface NotificationProviderResult {
  status: NotificationProviderResultStatus;
  providerMessageId?: string;
  failureReason?: string;
}

export interface NotificationProvider {
  readonly providerName: string;
  send(input: NotificationProviderInput): Promise<NotificationProviderResult>;
}

// DI tokens - one per channel, so NotificationDeliveryService can resolve
// "the provider currently configured for this channel" without an
// if/else chain hardcoding class names, and so a real provider can be
// swapped in for exactly one channel via a module-level binding change.
export const IN_APP_PROVIDER = Symbol('IN_APP_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
