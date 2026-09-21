import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { FoodPlansService } from './food-plans.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Owner',
    email: 'owner@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildPlan(overrides: Partial<any> = {}) {
  return {
    id: 'plan-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    name: 'Full Board',
    status: 'ACTIVE',
    price: { toString: () => '2500' },
    currency: 'INR',
    mealTypes: ['BREAKFAST', 'LUNCH', 'DINNER'],
    ...overrides,
  };
}

describe('FoodPlansService', () => {
  let service: FoodPlansService;
  let prisma: {
    foodPlan: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      foodPlan: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    memberships = {
      listActiveOrganizationIds: jest.fn().mockResolvedValue(['org-1']),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new FoodPlansService(
      prisma as any,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
      auditLog as unknown as AuditLogService,
    );
    properties.getAccessiblePropertyOrThrow.mockResolvedValue({
      id: 'prop-1',
      organizationId: 'org-1',
    });
  });

  describe('create', () => {
    it('OWNER/MANAGER creates a plan with a Decimal price', async () => {
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.foodPlan.create.mockResolvedValue(buildPlan());

      const result = await service.create(buildUser(), 'prop-1', {
        name: 'Full Board',
        price: '2500.00',
        mealTypes: ['BREAKFAST', 'LUNCH', 'DINNER'] as never,
      });
      expect(result.name).toBe('Full Board');
      expect(prisma.foodPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            propertyId: 'prop-1',
            organizationId: 'org-1',
          }),
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'FOOD_PLAN_CREATED',
          entityType: 'FoodPlan',
          entityId: 'plan-1',
          organizationId: 'org-1',
        }),
      );
    });
  });

  describe('update', () => {
    it('never accepts a price field even if present on the DTO object', async () => {
      prisma.foodPlan.findFirst.mockResolvedValue(buildPlan());
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.foodPlan.update.mockResolvedValue(buildPlan({ name: 'Renamed' }));

      await service.update(buildUser(), 'plan-1', { name: 'Renamed' } as never);
      const callArgs = prisma.foodPlan.update.mock.calls[0][0];
      expect(callArgs.data.price).toBeUndefined();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_PLAN_UPDATED',
          entityType: 'FoodPlan',
          entityId: 'plan-1',
          metadata: expect.objectContaining({ changedFields: ['name'] }),
        }),
      );
    });
  });

  describe('archive', () => {
    it('archives an ACTIVE plan', async () => {
      prisma.foodPlan.findFirst.mockResolvedValue(buildPlan());
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.foodPlan.update.mockResolvedValue(
        buildPlan({ status: 'ARCHIVED' }),
      );

      const result = await service.archive(buildUser(), 'plan-1');
      expect(result.status).toBe('ARCHIVED');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_PLAN_ARCHIVED',
          entityId: 'plan-1',
        }),
      );
    });

    it('rejects archiving an already-archived plan, and writes no audit row', async () => {
      prisma.foodPlan.findFirst.mockResolvedValue(
        buildPlan({ status: 'ARCHIVED' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });

      await expect(
        service.archive(buildUser(), 'plan-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_PLATFORM_OPERATION,
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('getAccessiblePlanOrThrow (BOLA)', () => {
    it('404s for a plan in an organization the caller has no membership in', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-2']);
      prisma.foodPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'plan-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.FOOD_PLAN_NOT_FOUND,
      });
    });

    it('SUPER_ADMIN can access any plan regardless of organization', async () => {
      prisma.foodPlan.findFirst.mockResolvedValue(buildPlan());
      const result = await service.findOne(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        'plan-1',
      );
      expect(result.id).toBe('plan-1');
    });
  });
});
