// The closed, documented set of notification types this backend actually
// emits (spec section 10/86). Deliberately a plain TS const object, not a
// Prisma enum - `Notification.type` is a `String` column for the same
// "grows independently, never needs a migration" reasoning `AuditLog
// .action` already established (Phase 8). Adding a new type is a code
// change in this one file plus a template entry, never a schema
// migration.
export const NotificationType = {
  RESIDENCY_CHECKED_IN: 'RESIDENCY_CHECKED_IN',
  RESIDENCY_NOTICE_PERIOD: 'RESIDENCY_NOTICE_PERIOD',
  RESIDENCY_CHECKED_OUT: 'RESIDENCY_CHECKED_OUT',

  RENT_INVOICE_ISSUED: 'RENT_INVOICE_ISSUED',
  RENT_INVOICE_OVERDUE: 'RENT_INVOICE_OVERDUE',
  RENT_PAYMENT_SUCCESS: 'RENT_PAYMENT_SUCCESS',
  RENT_PAYMENT_FAILED: 'RENT_PAYMENT_FAILED',

  FOOD_MENU_PUBLISHED: 'FOOD_MENU_PUBLISHED',
  FOOD_MENU_UPDATED: 'FOOD_MENU_UPDATED',
  FOOD_SUBSCRIPTION_CREATED: 'FOOD_SUBSCRIPTION_CREATED',
  FOOD_SUBSCRIPTION_PAUSED: 'FOOD_SUBSCRIPTION_PAUSED',
  FOOD_SUBSCRIPTION_RESUMED: 'FOOD_SUBSCRIPTION_RESUMED',
  FOOD_SUBSCRIPTION_CANCELLED: 'FOOD_SUBSCRIPTION_CANCELLED',
  FOOD_SUBSCRIPTION_PAYMENT_DUE: 'FOOD_SUBSCRIPTION_PAYMENT_DUE',
  FOOD_SUBSCRIPTION_PAYMENT_SUCCESS: 'FOOD_SUBSCRIPTION_PAYMENT_SUCCESS',

  COMPLAINT_CREATED: 'COMPLAINT_CREATED',
  COMPLAINT_ASSIGNED: 'COMPLAINT_ASSIGNED',
  COMPLAINT_STATUS_CHANGED: 'COMPLAINT_STATUS_CHANGED',
  COMPLAINT_RESOLVED: 'COMPLAINT_RESOLVED',
  COMPLAINT_CLOSED: 'COMPLAINT_CLOSED',

  SAAS_SUBSCRIPTION_RENEWAL_DUE: 'SAAS_SUBSCRIPTION_RENEWAL_DUE',
  SAAS_SUBSCRIPTION_PAYMENT_SUCCESS: 'SAAS_SUBSCRIPTION_PAYMENT_SUCCESS',
  SAAS_SUBSCRIPTION_PAYMENT_FAILED: 'SAAS_SUBSCRIPTION_PAYMENT_FAILED',
  SAAS_SUBSCRIPTION_SUSPENDED: 'SAAS_SUBSCRIPTION_SUSPENDED',

  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

// Channel-level mandatory policy (spec section 22/51): IN_APP can never be
// disabled for any notification type - it is how a user sees their own
// history at all, and disabling it would silently make notifications
// disappear rather than skip an external channel. No notification *type*
// is blanket-mandatory in Phase 11 (spec: "do not blindly classify
// everything as mandatory") - only this one channel-level rule exists
// today; a future phase can add type-level mandatory rules (e.g. security
// alerts) without changing this policy's shape.
export const MANDATORY_CHANNEL = 'IN_APP' as const;
