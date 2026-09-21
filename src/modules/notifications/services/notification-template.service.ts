import { Injectable } from '@nestjs/common';
import { NotificationPriority } from '@prisma/client';
import { NotificationType } from '../enums/notification-type.enum';

export interface RenderedNotification {
  title: string;
  body: string;
  priority: NotificationPriority;
}

interface TemplateDefinition {
  title: string;
  body: string;
  priority?: NotificationPriority;
}

// Centralized wording (spec section 11/48) - business modules never
// construct a title/body string themselves, they only emit a semantic
// event; this is the one place that decides what a user actually reads.
// `{{variable}}` is the only templating construct supported - see
// `renderTemplate` below for why this is safe against injection (spec
// section 49).
const TEMPLATES: Record<NotificationType, TemplateDefinition> = {
  RESIDENCY_CHECKED_IN: {
    title: 'Welcome to your PG',
    body: 'You have been checked in to {{propertyName}}.',
  },
  RESIDENCY_NOTICE_PERIOD: {
    title: 'Notice period started',
    body: 'Your notice period at {{propertyName}} has started.',
  },
  RESIDENCY_CHECKED_OUT: {
    title: 'Checked out',
    body: 'Your residency at {{propertyName}} has been checked out.',
  },
  RENT_INVOICE_ISSUED: {
    title: 'Rent invoice issued',
    body: 'Invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}.',
  },
  RENT_INVOICE_OVERDUE: {
    title: 'Rent invoice overdue',
    body: 'Invoice {{invoiceNumber}} for {{amount}} is now overdue.',
    priority: 'HIGH',
  },
  RENT_PAYMENT_SUCCESS: {
    title: 'Payment successful',
    body: 'Your payment of {{amount}} was received.',
  },
  RENT_PAYMENT_FAILED: {
    title: 'Payment failed',
    body: 'Your payment of {{amount}} could not be completed.',
    priority: 'HIGH',
  },
  FOOD_MENU_PUBLISHED: {
    title: "Today's food menu is published",
    body: 'The menu for {{date}} at {{propertyName}} has been published.',
  },
  FOOD_MENU_UPDATED: {
    title: 'Food menu updated',
    body: 'The menu for {{date}} at {{propertyName}} has been updated.',
  },
  FOOD_SUBSCRIPTION_CREATED: {
    title: 'Food subscription started',
    body: 'Your food subscription to {{planName}} is now active.',
  },
  FOOD_SUBSCRIPTION_PAUSED: {
    title: 'Food subscription paused',
    body: 'Your food subscription has been paused.',
  },
  FOOD_SUBSCRIPTION_RESUMED: {
    title: 'Food subscription resumed',
    body: 'Your food subscription is active again.',
  },
  FOOD_SUBSCRIPTION_CANCELLED: {
    title: 'Food subscription cancelled',
    body: 'Your food subscription has been cancelled.',
  },
  FOOD_SUBSCRIPTION_PAYMENT_DUE: {
    title: 'Food payment due',
    body: 'Your food subscription payment of {{amount}} is due.',
  },
  FOOD_SUBSCRIPTION_PAYMENT_SUCCESS: {
    title: 'Food payment successful',
    body: 'Your food subscription payment of {{amount}} was received.',
  },
  COMPLAINT_CREATED: {
    title: 'New complaint reported',
    body: '{{category}} complaint reported at {{propertyName}}: {{title}}.',
  },
  COMPLAINT_ASSIGNED: {
    title: 'Complaint assigned to you',
    body: 'You have been assigned complaint: {{title}}.',
  },
  COMPLAINT_STATUS_CHANGED: {
    title: 'Complaint status updated',
    body: 'Your complaint "{{title}}" is now {{status}}.',
  },
  COMPLAINT_RESOLVED: {
    title: 'Complaint resolved',
    body: 'Your complaint "{{title}}" has been resolved.',
  },
  COMPLAINT_CLOSED: {
    title: 'Complaint closed',
    body: 'Your complaint "{{title}}" has been closed.',
  },
  SAAS_SUBSCRIPTION_RENEWAL_DUE: {
    title: 'Subscription renewal due',
    body: 'Your platform subscription renewal is due on {{dueDate}}.',
  },
  SAAS_SUBSCRIPTION_PAYMENT_SUCCESS: {
    title: 'Subscription payment successful',
    body: 'Your platform subscription payment of {{amount}} was received.',
  },
  SAAS_SUBSCRIPTION_PAYMENT_FAILED: {
    title: 'Subscription payment failed',
    body: 'Your platform subscription payment of {{amount}} could not be completed.',
    priority: 'HIGH',
  },
  SAAS_SUBSCRIPTION_SUSPENDED: {
    title: 'Subscription suspended',
    body: 'Your platform subscription has been suspended. Please make a payment to restore access.',
    priority: 'URGENT',
  },
  SYSTEM_ANNOUNCEMENT: {
    title: '{{title}}',
    body: '{{body}}',
  },
};

@Injectable()
export class NotificationTemplateService {
  render(
    type: NotificationType,
    vars: Record<string, string> = {},
  ): RenderedNotification {
    const template = TEMPLATES[type];
    return {
      title: renderTemplate(template.title, vars),
      body: renderTemplate(template.body, vars),
      priority: template.priority ?? 'NORMAL',
    };
  }
}

// The only templating construct supported is `{{key}}` plain substitution
// against a flat string map the caller controls entirely server-side
// (spec section 48-49) - never `eval`, never a general-purpose template
// engine, and the substituted value is inserted as-is into a plain-text
// field (never interpreted as HTML/SQL/script by any consumer), so there
// is no injection surface even though the values ultimately originate
// from database content (e.g. a property name).
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
