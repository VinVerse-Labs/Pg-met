import { NotificationEventService } from './notification-event.service';
import { NotificationType } from '../enums/notification-type.enum';

describe('NotificationEventService', () => {
  let service: NotificationEventService;
  let prisma: any;
  let eventBus: { on: jest.Mock };
  let notifications: { publish: jest.Mock };
  let recipients: {
    activeTenantUserIdsForProperty: jest.Mock;
    activeOrgMembersByRole: jest.Mock;
    tenantUserIdForResidency: jest.Mock;
  };
  let handlers: Map<string, (payload: any) => Promise<void>>;

  beforeEach(() => {
    prisma = {
      residency: { findUnique: jest.fn() },
      invoice: { findUnique: jest.fn() },
      payment: { findUnique: jest.fn() },
      menu: { findUnique: jest.fn() },
      tenantFoodSubscription: { findUnique: jest.fn() },
      foodSubscriptionInvoice: { findFirst: jest.fn() },
      foodSubscriptionPayment: { findUnique: jest.fn() },
      complaint: { findUnique: jest.fn() },
      subscriptionPayment: { findUnique: jest.fn() },
    };
    handlers = new Map();
    eventBus = {
      on: jest.fn((type: string, handler: any) => handlers.set(type, handler)),
    };
    notifications = { publish: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    recipients = {
      activeTenantUserIdsForProperty: jest.fn().mockResolvedValue([]),
      activeOrgMembersByRole: jest.fn().mockResolvedValue([]),
      tenantUserIdForResidency: jest.fn().mockResolvedValue(null),
    };

    service = new NotificationEventService(
      prisma,
      eventBus as any,
      notifications as any,
      recipients as any,
    );
    service.onModuleInit();
  });

  it('registers a handler for every documented notification type touching Phase 11 wiring', () => {
    const registeredTypes = [...handlers.keys()];
    expect(registeredTypes).toEqual(
      expect.arrayContaining([
        NotificationType.RESIDENCY_CHECKED_IN,
        NotificationType.RESIDENCY_CHECKED_OUT,
        NotificationType.RENT_INVOICE_ISSUED,
        NotificationType.RENT_INVOICE_OVERDUE,
        NotificationType.RENT_PAYMENT_SUCCESS,
        NotificationType.RENT_PAYMENT_FAILED,
        NotificationType.FOOD_MENU_PUBLISHED,
        NotificationType.FOOD_MENU_UPDATED,
        NotificationType.FOOD_SUBSCRIPTION_CREATED,
        NotificationType.FOOD_SUBSCRIPTION_PAUSED,
        NotificationType.FOOD_SUBSCRIPTION_RESUMED,
        NotificationType.FOOD_SUBSCRIPTION_CANCELLED,
        NotificationType.FOOD_SUBSCRIPTION_PAYMENT_DUE,
        NotificationType.FOOD_SUBSCRIPTION_PAYMENT_SUCCESS,
        NotificationType.COMPLAINT_CREATED,
        NotificationType.COMPLAINT_ASSIGNED,
        NotificationType.COMPLAINT_STATUS_CHANGED,
        NotificationType.COMPLAINT_RESOLVED,
        NotificationType.COMPLAINT_CLOSED,
        NotificationType.SAAS_SUBSCRIPTION_RENEWAL_DUE,
        NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
        NotificationType.SAAS_SUBSCRIPTION_PAYMENT_SUCCESS,
        NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
      ]),
    );
    // RESIDENCY_NOTICE_PERIOD has no wired trigger anywhere in the
    // codebase (documented known limitation) - no handler is registered.
    expect(registeredTypes).not.toContain(
      NotificationType.RESIDENCY_NOTICE_PERIOD,
    );
  });

  describe('residency check-in', () => {
    it('re-reads the residency fresh from Postgres and publishes to the tenant it currently resolves to', async () => {
      prisma.residency.findUnique.mockResolvedValue({
        id: 'res-1',
        propertyId: 'prop-1',
        tenant: { userId: 'tenant-user-1' },
        property: { organizationId: 'org-1', name: 'Sunrise PG' },
      });

      await handlers.get(NotificationType.RESIDENCY_CHECKED_IN)!({
        residencyId: 'res-1',
      });

      expect(notifications.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'tenant-user-1',
          type: NotificationType.RESIDENCY_CHECKED_IN,
          idempotencyKey: `${NotificationType.RESIDENCY_CHECKED_IN}:res-1`,
        }),
      );
    });

    it('does nothing (never throws) when the residency no longer exists', async () => {
      prisma.residency.findUnique.mockResolvedValue(null);
      await expect(
        handlers.get(NotificationType.RESIDENCY_CHECKED_IN)!({
          residencyId: 'gone',
        }),
      ).resolves.toBeUndefined();
      expect(notifications.publish).not.toHaveBeenCalled();
    });
  });

  describe('food menu published - cross-property isolation', () => {
    it('only notifies tenants resolved for the menu’s own property, never another property', async () => {
      prisma.menu.findUnique.mockResolvedValue({
        id: 'menu-1',
        propertyId: 'prop-A',
        organizationId: 'org-1',
        date: new Date('2026-09-21'),
        updatedAt: new Date('2026-09-21T10:00:00Z'),
        property: { name: 'Property A' },
      });
      recipients.activeTenantUserIdsForProperty.mockResolvedValue([
        'tenant-A1',
        'tenant-A2',
      ]);

      await handlers.get(NotificationType.FOOD_MENU_PUBLISHED)!({
        menuId: 'menu-1',
      });

      expect(recipients.activeTenantUserIdsForProperty).toHaveBeenCalledWith(
        'prop-A',
      );
      expect(notifications.publish).toHaveBeenCalledTimes(2);
      const publishedUserIds = notifications.publish.mock.calls.map(
        (c) => c[0].userId,
      );
      expect(publishedUserIds.sort()).toEqual(['tenant-A1', 'tenant-A2']);
    });

    it('publishes nothing when the menu no longer exists', async () => {
      prisma.menu.findUnique.mockResolvedValue(null);
      await handlers.get(NotificationType.FOOD_MENU_PUBLISHED)!({
        menuId: 'gone',
      });
      expect(notifications.publish).not.toHaveBeenCalled();
    });
  });

  describe('rent payment success', () => {
    it('only publishes when the re-read payment is actually CAPTURED (never trusts the event payload’s implied outcome)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        status: 'FAILED',
        payerUserId: 'u1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        amount: { toString: () => '1000' },
        invoiceId: 'inv-1',
      });

      await handlers.get(NotificationType.RENT_PAYMENT_SUCCESS)!({
        paymentId: 'pay-1',
      });
      expect(notifications.publish).not.toHaveBeenCalled();
    });

    it('publishes when the re-read payment is CAPTURED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        status: 'CAPTURED',
        payerUserId: 'u1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        amount: { toString: () => '1000' },
        invoiceId: 'inv-1',
      });

      await handlers.get(NotificationType.RENT_PAYMENT_SUCCESS)!({
        paymentId: 'pay-1',
      });
      expect(notifications.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: NotificationType.RENT_PAYMENT_SUCCESS,
        }),
      );
    });
  });

  describe('complaint created - staff fan-out', () => {
    it('notifies every active OWNER/MANAGER in the organization, one notification each', async () => {
      prisma.complaint.findUnique.mockResolvedValue({
        id: 'complaint-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        category: 'PLUMBING',
        title: 'Leaking tap',
        property: { name: 'Sunrise PG' },
      });
      recipients.activeOrgMembersByRole.mockResolvedValue([
        'owner-1',
        'manager-1',
      ]);

      await handlers.get(NotificationType.COMPLAINT_CREATED)!({
        complaintId: 'complaint-1',
      });

      expect(recipients.activeOrgMembersByRole).toHaveBeenCalledWith('org-1', [
        'OWNER',
        'MANAGER',
      ]);
      expect(notifications.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('complaint assigned', () => {
    it('does nothing when the complaint has no assignee', async () => {
      prisma.complaint.findUnique.mockResolvedValue({
        id: 'c1',
        assignedToUserId: null,
      });
      await handlers.get(NotificationType.COMPLAINT_ASSIGNED)!({
        complaintId: 'c1',
      });
      expect(notifications.publish).not.toHaveBeenCalled();
    });
  });
});
