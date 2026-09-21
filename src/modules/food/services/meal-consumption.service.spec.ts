import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { MealConsumptionService } from './meal-consumption.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Staff',
    email: 'staff@example.com',
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

describe('MealConsumptionService', () => {
  let service: MealConsumptionService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock; assertRole: jest.Mock };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };

  beforeEach(() => {
    prisma = {
      residency: { findFirst: jest.fn() },
      menu: { findFirst: jest.fn() },
      mealConsumption: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      tenant: { findUnique: jest.fn() },
    };
    memberships = { getActiveMembership: jest.fn(), assertRole: jest.fn() };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    service = new MealConsumptionService(
      prisma,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
    );
    properties.getAccessiblePropertyOrThrow.mockResolvedValue({
      id: 'prop-1',
      organizationId: 'org-1',
    });
    memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
  });

  describe('create', () => {
    it('snapshots the menu item names at the moment of marking', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        tenantId: 'tenant-1',
      });
      prisma.menu.findFirst.mockResolvedValue({
        id: 'menu-1',
        items: [{ name: 'Dal' }, { name: 'Rice' }],
      });
      prisma.mealConsumption.create.mockResolvedValue({
        id: 'mc-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        tenantId: 'tenant-1',
        residencyId: 'res-1',
        menuId: 'menu-1',
        mealType: 'LUNCH',
        mealDate: new Date('2026-10-01'),
        itemNamesSnapshot: ['Dal', 'Rice'],
        consumedAt: new Date(),
        source: 'STAFF_MARKED',
      });

      const result = await service.create(buildUser(), 'prop-1', {
        residencyId: 'res-1',
        mealType: 'LUNCH' as never,
        mealDate: '2026-10-01',
        menuId: 'menu-1',
      });
      expect(result.itemNamesSnapshot).toEqual(['Dal', 'Rice']);
    });

    it('rejects a duplicate consumption record for the same meal period (unique violation)', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        tenantId: 'tenant-1',
      });
      prisma.mealConsumption.create.mockRejectedValue(
        p2002('meal_consumption_unique'),
      );

      await expect(
        service.create(buildUser(), 'prop-1', {
          residencyId: 'res-1',
          mealType: 'LUNCH' as never,
          mealDate: '2026-10-01',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.MEAL_ALREADY_RECORDED });
    });

    it('404s for a residency not at this property', async () => {
      prisma.residency.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildUser(), 'prop-1', {
          residencyId: 'res-1',
          mealType: 'LUNCH' as never,
          mealDate: '2026-10-01',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.RESIDENCY_NOT_FOUND });
    });
  });
});
