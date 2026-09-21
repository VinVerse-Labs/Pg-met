import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { NotificationPreferencesService } from './notification-preferences.service';

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

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      notificationPreference: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    service = new NotificationPreferencesService(prisma);
  });

  describe('findForUser', () => {
    it('scopes to the caller’s own userId, ordered by type then channel', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      await service.findForUser(buildUser());
      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ notificationType: 'asc' }, { channel: 'asc' }],
      });
    });
  });

  describe('update', () => {
    it('rejects disabling the mandatory IN_APP channel before writing anything', async () => {
      await expect(
        service.update(buildUser(), {
          preferences: [
            {
              notificationType: 'FOOD_MENU_UPDATED',
              channel: 'IN_APP' as any,
              enabled: false,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOTIFICATION_MANDATORY_TYPE });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows enabling IN_APP explicitly (only disabling is rejected)', async () => {
      prisma.$transaction.mockResolvedValue(undefined);
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.update(buildUser(), {
        preferences: [
          {
            notificationType: 'FOOD_MENU_UPDATED',
            channel: 'IN_APP' as any,
            enabled: true,
          },
        ],
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('upserts every (type, channel) pair in a single transaction, scoped to the caller', async () => {
      prisma.$transaction.mockImplementation(async (ops: any[]) => {
        expect(Array.isArray(ops)).toBe(true);
        return ops;
      });
      prisma.notificationPreference.upsert.mockReturnValue('op');
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.update(buildUser(), {
        preferences: [
          {
            notificationType: 'FOOD_MENU_UPDATED',
            channel: 'EMAIL' as any,
            enabled: true,
          },
          {
            notificationType: 'RENT_INVOICE_ISSUED',
            channel: 'PUSH' as any,
            enabled: false,
          },
        ],
      });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
      const firstCallArgs =
        prisma.notificationPreference.upsert.mock.calls[0][0];
      expect(
        firstCallArgs.where.notification_preferences_user_type_channel_unique,
      ).toEqual({
        userId: 'user-1',
        notificationType: 'FOOD_MENU_UPDATED',
        channel: 'EMAIL',
      });
    });
  });

  describe('isChannelEnabled', () => {
    it('always reports the mandatory channel enabled regardless of any stored row', async () => {
      const result = await service.isChannelEnabled(
        'user-1',
        'ANY_TYPE',
        'IN_APP' as any,
      );
      expect(result).toBe(true);
      expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULT_ENABLED when no explicit preference row exists (PUSH defaults true)', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      const result = await service.isChannelEnabled(
        'user-1',
        'RENT_INVOICE_ISSUED',
        'PUSH' as any,
      );
      expect(result).toBe(true);
    });

    it('falls back to DEFAULT_ENABLED for EMAIL (defaults false)', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      const result = await service.isChannelEnabled(
        'user-1',
        'RENT_INVOICE_ISSUED',
        'EMAIL' as any,
      );
      expect(result).toBe(false);
    });

    it('honors an explicit stored preference over the default', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      const result = await service.isChannelEnabled(
        'user-1',
        'RENT_INVOICE_ISSUED',
        'EMAIL' as any,
      );
      expect(result).toBe(true);
    });
  });
});
