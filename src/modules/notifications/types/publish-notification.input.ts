import { NotificationPriority } from '@prisma/client';
import { NotificationType } from '../enums/notification-type.enum';

// The one simple internal API business modules use indirectly, via
// NotificationEventService (spec section 84) - nothing outside the
// notifications module ever constructs a Notification row by hand.
export interface PublishNotificationInput {
  userId: string;
  type: NotificationType;
  // The actual business-event dedupe key (spec section 31-32), e.g.
  // `RENT_PAYMENT_SUCCESS:<paymentId>` - never random, always derived
  // from the real event so a retried business operation can never
  // generate a second notification for the same occurrence. Enforced by
  // Notification.idempotencyKey's own database @unique, not just this
  // check.
  idempotencyKey: string;
  templateVars?: Record<string, string>;
  data?: Record<string, unknown>;
  organizationId?: string | null;
  propertyId?: string | null;
  priority?: NotificationPriority;
  expiresAt?: Date | null;
}
