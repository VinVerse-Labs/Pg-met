import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { FoodMenusService } from './food-menus.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Manager',
    email: 'manager@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

function buildMenu(overrides: Partial<any> = {}) {
  return {
    id: 'menu-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    date: new Date('2026-10-01'),
    status: 'DRAFT',
    items: [],
    ...overrides,
  };
}

describe('FoodMenusService', () => {
  let service: FoodMenusService;
  let prisma: any;
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let auditLog: { record: jest.Mock };
  let eventBus: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      menu: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      menuItem: {
        create: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    memberships = {
      listActiveOrganizationIds: jest.fn().mockResolvedValue(['org-1']),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new FoodMenusService(
      prisma,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
      auditLog as unknown as AuditLogService,
      eventBus as unknown as DomainEventBusService,
    );
    properties.getAccessiblePropertyOrThrow.mockResolvedValue({
      id: 'prop-1',
      organizationId: 'org-1',
    });
    memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });
  });

  describe('createDaily', () => {
    it('creates a DRAFT menu with items', async () => {
      prisma.menu.create.mockResolvedValue(
        buildMenu({
          items: [{ id: 'item-1', mealType: 'BREAKFAST', name: 'Poha' }],
        }),
      );

      const result = await service.createDaily(buildUser(), 'prop-1', {
        date: '2026-10-01',
        items: [{ mealType: 'BREAKFAST', name: 'Poha' } as never],
      });
      expect(result.status).toBe('DRAFT');
      expect(result.items).toHaveLength(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'FOOD_MENU_CREATED',
          entityType: 'Menu',
          entityId: 'menu-1',
          organizationId: 'org-1',
          metadata: expect.objectContaining({
            propertyId: 'prop-1',
            date: '2026-10-01',
          }),
        }),
      );
    });

    it('translates a concurrent duplicate-menu race into MENU_ALREADY_EXISTS', async () => {
      prisma.menu.create.mockRejectedValue(p2002('propertyId,date'));

      await expect(
        service.createDaily(buildUser(), 'prop-1', { date: '2026-10-01' }),
      ).rejects.toMatchObject({ code: ErrorCode.MENU_ALREADY_EXISTS });
    });
  });

  describe('publish', () => {
    it('DRAFT -> PUBLISHED atomically', async () => {
      prisma.menu.findFirst.mockResolvedValue(buildMenu());
      prisma.menu.updateMany.mockResolvedValue({ count: 1 });
      prisma.menu.findUniqueOrThrow.mockResolvedValue(
        buildMenu({ status: 'PUBLISHED' }),
      );

      const result = await service.publish(buildUser(), 'menu-1');
      expect(result.status).toBe('PUBLISHED');
      expect(prisma.menu.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'menu-1', status: 'DRAFT' } }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_MENU_PUBLISHED',
          entityId: 'menu-1',
        }),
      );
    });

    it('rejects publishing an already-published menu (lost race -> count 0), and writes no audit row', async () => {
      prisma.menu.findFirst.mockResolvedValue(
        buildMenu({ status: 'PUBLISHED' }),
      );
      prisma.menu.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.publish(buildUser(), 'menu-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.MENU_ALREADY_PUBLISHED,
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a menu', async () => {
      prisma.menu.findFirst.mockResolvedValue(
        buildMenu({ status: 'PUBLISHED' }),
      );
      prisma.menu.updateMany.mockResolvedValue({ count: 1 });
      prisma.menu.findUniqueOrThrow.mockResolvedValue(
        buildMenu({ status: 'CANCELLED' }),
      );

      const result = await service.cancel(buildUser(), 'menu-1');
      expect(result.status).toBe('CANCELLED');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_MENU_CANCELLED',
          entityId: 'menu-1',
        }),
      );
    });

    it('rejects cancelling an already-cancelled menu', async () => {
      prisma.menu.findFirst.mockResolvedValue(
        buildMenu({ status: 'CANCELLED' }),
      );
      prisma.menu.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(buildUser(), 'menu-1')).rejects.toMatchObject(
        {
          code: ErrorCode.MENU_CANCELLED,
        },
      );
    });
  });

  describe('replaceItems', () => {
    it('replaces every item on a DRAFT menu in one transaction', async () => {
      prisma.menu.findFirst.mockResolvedValue(buildMenu());
      const tx = {
        menuItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        menu: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(
            buildMenu({
              items: [{ id: 'i1', mealType: 'LUNCH', name: 'Chole' }],
            }),
          ),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.replaceItems(buildUser(), 'menu-1', [
        { mealType: 'LUNCH', name: 'Chole' } as never,
      ]);
      expect(result.items[0].name).toBe('Chole');
      expect(tx.menuItem.deleteMany).toHaveBeenCalledWith({
        where: { menuId: 'menu-1' },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_MENU_UPDATED',
          entityId: 'menu-1',
        }),
      );
    });

    it('allows live-editing items on an already-PUBLISHED menu (spec: today’s menu updates propagate immediately)', async () => {
      prisma.menu.findFirst.mockResolvedValue(
        buildMenu({ status: 'PUBLISHED' }),
      );
      const tx = {
        menuItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        menu: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(
            buildMenu({
              status: 'PUBLISHED',
              items: [{ id: 'i1', mealType: 'LUNCH', name: 'Chole' }],
            }),
          ),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.replaceItems(buildUser(), 'menu-1', [
        { mealType: 'LUNCH', name: 'Chole' } as never,
      ]);
      expect(result.items[0].name).toBe('Chole');
    });

    it('rejects editing items on a CANCELLED menu', async () => {
      prisma.menu.findFirst.mockResolvedValue(
        buildMenu({ status: 'CANCELLED' }),
      );

      await expect(
        service.replaceItems(buildUser(), 'menu-1', []),
      ).rejects.toMatchObject({ code: ErrorCode.MENU_CANCELLED });
    });
  });

  describe('putWeek', () => {
    it('creates/updates up to 7 days inside one transaction, never publishing', async () => {
      const tx = {
        menu: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(buildMenu({ id: 'menu-mon' })),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue(buildMenu({ id: 'menu-mon', items: [] })),
        },
        menuItem: { deleteMany: jest.fn(), createMany: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.putWeek(buildUser(), 'prop-1', {
        days: [
          {
            date: '2026-10-05',
            items: [{ mealType: 'BREAKFAST', name: 'Poha' } as never],
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('DRAFT');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_MENU_CREATED',
          entityId: 'menu-mon',
        }),
      );
    });
  });

  describe('access control', () => {
    it('an unrelated org member (STAFF) cannot publish (role check), and writes no audit row', async () => {
      prisma.menu.findFirst.mockResolvedValue(buildMenu());
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      memberships.assertRole.mockImplementation(() => {
        throw new Error('INSUFFICIENT_ROLE');
      });

      await expect(service.publish(buildUser(), 'menu-1')).rejects.toThrow();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('a menu outside the caller’s organizations is 404 (BOLA)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-2']);
      prisma.menu.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForOrg(buildUser(), 'menu-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.MENU_NOT_FOUND,
      });
    });
  });
});
