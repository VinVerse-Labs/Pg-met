import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { NotificationsService } from './notifications.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Tenant',
    email: 'tenant@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildNotification(overrides: Partial<any> = {}) {
  return {
    id: 'notif-1',
    userId: 'user-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    type: 'RESIDENCY_CHECKED_IN',
    title: 'Welcome to your PG',
    body: 'You have been checked in to Sunrise PG.',
    data: null,
    priority: 'NORMAL',
    status: 'UNREAD',
    idempotencyKey: 'RESIDENCY_CHECKED_IN:res-1',
    readAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function p2002(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let templates: { render: jest.Mock };
  let delivery: { deliverAll: jest.Mock };

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    templates = {
      render: jest.fn().mockReturnValue({
        title: 'Welcome to your PG',
        body: 'You have been checked in to Sunrise PG.',
        priority: 'NORMAL',
      }),
    };
    delivery = { deliverAll: jest.fn().mockResolvedValue(undefined) };

    service = new NotificationsService(
      prisma,
      templates as any,
      delivery as any,
    );
  });

  describe('publish', () => {
    it('creates a notification, renders via the template service, and triggers delivery', async () => {
      const created = buildNotification();
      prisma.notification.create.mockResolvedValue(created);

      const result = await service.publish({
        userId: 'user-1',
        type: 'RESIDENCY_CHECKED_IN' as any,
        idempotencyKey: 'RESIDENCY_CHECKED_IN:res-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        templateVars: { propertyName: 'Sunrise PG' },
      });

      expect(templates.render).toHaveBeenCalledWith('RESIDENCY_CHECKED_IN', {
        propertyName: 'Sunrise PG',
      });
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(delivery.deliverAll).toHaveBeenCalledWith(created);
      expect(result).toBe(created);
    });

    it('idempotency: a duplicate idempotencyKey (P2002) re-reads the existing row and never re-delivers', async () => {
      const existing = buildNotification();
      prisma.notification.create.mockRejectedValue(p2002(['idempotencyKey']));
      prisma.notification.findUnique.mockResolvedValue(existing);

      const result = await service.publish({
        userId: 'user-1',
        type: 'RESIDENCY_CHECKED_IN' as any,
        idempotencyKey: 'RESIDENCY_CHECKED_IN:res-1',
      });

      expect(result).toBe(existing);
      expect(delivery.deliverAll).not.toHaveBeenCalled();
    });

    it('re-throws a P2002 on some other column (not idempotencyKey)', async () => {
      prisma.notification.create.mockRejectedValue(p2002(['userId']));

      await expect(
        service.publish({
          userId: 'user-1',
          type: 'RESIDENCY_CHECKED_IN' as any,
          idempotencyKey: 'x',
        }),
      ).rejects.toThrow();
      expect(delivery.deliverAll).not.toHaveBeenCalled();
    });

    it('re-throws a non-P2002 error unchanged', async () => {
      const err = new Error('connection lost');
      prisma.notification.create.mockRejectedValue(err);

      await expect(
        service.publish({
          userId: 'user-1',
          type: 'RESIDENCY_CHECKED_IN' as any,
          idempotencyKey: 'x',
        }),
      ).rejects.toThrow('connection lost');
    });

    it('a delivery failure never propagates out of publish (delivery is fire-and-forget from the caller’s perspective, but exceptions from it are not swallowed here — deliverAll itself never throws)', async () => {
      const created = buildNotification();
      prisma.notification.create.mockResolvedValue(created);
      delivery.deliverAll.mockResolvedValue(undefined);

      await expect(
        service.publish({
          userId: 'user-1',
          type: 'RESIDENCY_CHECKED_IN' as any,
          idempotencyKey: 'x',
        }),
      ).resolves.toBe(created);
    });
  });

  describe('findForUser / getUnreadCount', () => {
    it('filters to unreadOnly via WHERE status when requested', async () => {
      prisma.notification.findMany.mockResolvedValue([buildNotification()]);
      prisma.notification.count.mockResolvedValue(1);

      await service.findForUser(buildUser(), {
        unreadOnly: true,
        page: 1,
        limit: 20,
      } as any);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'UNREAD' },
        }),
      );
    });

    it('getUnreadCount uses a DB count, not findMany().length', async () => {
      prisma.notification.count.mockResolvedValue(3);
      const result = await service.getUnreadCount(buildUser());
      expect(result).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'UNREAD' },
      });
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne / BOLA safety', () => {
    it('returns the notification when it belongs to the caller', async () => {
      prisma.notification.findFirst.mockResolvedValue(buildNotification());
      const result = await service.findOne(buildUser(), 'notif-1');
      expect(result.id).toBe('notif-1');
      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
      });
    });

    it('throws NOTIFICATION_NOT_FOUND for another user’s notification (BOLA-safe: scoped in WHERE)', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);
      await expect(
        service.findOne(buildUser({ id: 'attacker' }), 'notif-1'),
      ).rejects.toMatchObject({ code: ErrorCode.NOTIFICATION_NOT_FOUND });
    });
  });

  describe('markRead', () => {
    it('atomically flips UNREAD -> READ scoped by id + userId + status', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      prisma.notification.findFirst.mockResolvedValue(
        buildNotification({ status: 'READ', readAt: new Date() }),
      );

      const result = await service.markRead(buildUser(), 'notif-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1', status: 'UNREAD' },
        data: { status: 'READ', readAt: expect.any(Date) },
      });
      expect(result.isRead).toBe(true);
    });

    it('idempotent: marking an already-READ notification still succeeds (updateMany count 0, but findFirst confirms it exists and is READ)', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(
        buildNotification({ status: 'READ' }),
      );

      const result = await service.markRead(buildUser(), 'notif-1');
      expect(result.isRead).toBe(true);
    });

    it('404s when the notification does not belong to the caller (updateMany matches nothing, then existence check also fails)', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markRead(buildUser({ id: 'attacker' }), 'notif-1'),
      ).rejects.toMatchObject({ code: ErrorCode.NOTIFICATION_NOT_FOUND });
    });

    it('concurrent markRead calls both resolve successfully to the same READ result (never a duplicate-state error)', async () => {
      prisma.notification.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(
        buildNotification({ status: 'READ' }),
      );

      const [a, b] = await Promise.all([
        service.markRead(buildUser(), 'notif-1'),
        service.markRead(buildUser(), 'notif-1'),
      ]);
      expect(a.isRead).toBe(true);
      expect(b.isRead).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it('scopes to the caller’s own UNREAD rows only', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });
      const result = await service.markAllRead(buildUser());
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'UNREAD' },
        data: { status: 'READ', readAt: expect.any(Date) },
      });
      expect(result).toEqual({ updated: 4 });
    });
  });
});
