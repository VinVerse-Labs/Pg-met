import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { PushDevicesController } from './controllers/push-devices.controller';
import { NotificationAdminController } from './controllers/notification-admin.controller';
import { NotificationsService } from './services/notifications.service';
import { NotificationPreferencesService } from './services/notification-preferences.service';
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationDeliveryService } from './services/notification-delivery.service';
import { NotificationRecipientsService } from './services/notification-recipients.service';
import { NotificationEventService } from './services/notification-event.service';
import { PushDevicesService } from './services/push-devices.service';
import { InAppNotificationProvider } from './providers/in-app.provider';
import { NoopNotificationProvider } from './providers/noop.provider';
import {
  EMAIL_PROVIDER,
  IN_APP_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  WHATSAPP_PROVIDER,
} from './providers/notification-provider.interface';

// Business modules (Residencies, Invoices, Payments, Complaints, Food,
// Subscriptions) never import this module - they only inject
// `DomainEventBusService` (global, from `DomainEventBusModule`) and call
// `.emit(...)`. This is the one-directional dependency spec section 33/
// 105 asks for: notification infrastructure depends on nothing from any
// business module, and no business module depends on this one either.
@Module({
  imports: [AuthModule, PlatformAdminModule],
  // Order matters: Nest binds each controller's routes to the underlying
  // Express router in this array's order, and Express matches overlapping
  // routes first-registered-wins. NotificationsController's
  // `GET/POST 'me/notifications/:id...'` is a wildcard that would
  // otherwise shadow the literal `me/notifications/preferences` and
  // `me/notifications/devices` sub-paths (same segment count, so `:id`
  // would greedily match "preferences"/"devices" as an id) - the two
  // literal-path controllers are listed first so their routes win.
  controllers: [
    NotificationPreferencesController,
    PushDevicesController,
    NotificationAdminController,
    NotificationsController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationTemplateService,
    NotificationDeliveryService,
    NotificationRecipientsService,
    NotificationEventService,
    PushDevicesService,
    { provide: IN_APP_PROVIDER, useClass: InAppNotificationProvider },
    // PUSH/EMAIL/WHATSAPP/SMS all resolve to the same safe NOOP
    // implementation today (spec section 19/56/89) - swapping in a real
    // provider for exactly one channel later is a one-line change to
    // this binding, never a change to NotificationDeliveryService or any
    // business module.
    {
      provide: PUSH_PROVIDER,
      useFactory: () => new NoopNotificationProvider('PUSH'),
    },
    {
      provide: EMAIL_PROVIDER,
      useFactory: () => new NoopNotificationProvider('EMAIL'),
    },
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => new NoopNotificationProvider('WHATSAPP'),
    },
    {
      provide: SMS_PROVIDER,
      useFactory: () => new NoopNotificationProvider('SMS'),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
