import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { SubscriptionsService as SaasSubscriptionsService } from '../../subscriptions/subscriptions.service';
import { FoodConfigurationService } from './food-configuration.service';
import { FoodEntitlementService } from './food-entitlement.service';
import { FoodBillingService } from './food-billing.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { FoodSubscriptionsService } from './food-subscriptions.service';

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

function buildContext(overrides: Partial<any> = {}) {
  return {
    tenant: { id: 'tenant-1' },
    residency: { id: 'res-1' },
    property: { id: 'prop-1' },
    organizationId: 'org-1',
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

describe('FoodSubscriptionsService', () => {
  let service: FoodSubscriptionsService;
  let prisma: {
    foodPlan: { findFirst: jest.Mock };
    tenantFoodSubscription: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    property: { findUnique: jest.Mock };
  };
  let memberships: { getActiveMembership: jest.Mock };
  let foodConfiguration: { getOrCreate: jest.Mock };
  let entitlement: { getCallerResidencyContext: jest.Mock };
  let saasSubscriptions: { isOrganizationWriteBlocked: jest.Mock };
  let billing: { generateInvoiceForPeriod: jest.Mock };
  let auditLog: { record: jest.Mock };
  let eventBus: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      foodPlan: { findFirst: jest.fn() },
      tenantFoodSubscription: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      property: { findUnique: jest.fn() },
    };
    memberships = { getActiveMembership: jest.fn() };
    foodConfiguration = { getOrCreate: jest.fn() };
    entitlement = {
      getCallerResidencyContext: jest.fn().mockResolvedValue(buildContext()),
    };
    saasSubscriptions = {
      isOrganizationWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    billing = { generateInvoiceForPeriod: jest.fn().mockResolvedValue({}) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new FoodSubscriptionsService(
      prisma as any,
      memberships as unknown as MembershipsService,
      foodConfiguration as unknown as FoodConfigurationService,
      entitlement as unknown as FoodEntitlementService,
      saasSubscriptions as unknown as SaasSubscriptionsService,
      billing as unknown as FoodBillingService,
      auditLog as unknown as AuditLogService,
      eventBus as unknown as DomainEventBusService,
    );
  });

  describe('subscribe', () => {
    const activePlan = {
      id: 'plan-1',
      propertyId: 'prop-1',
      status: 'ACTIVE',
      price: new Prisma.Decimal('2500.00'),
      currency: 'INR',
      mealTypes: ['LUNCH', 'DINNER'],
    };

    it('creates a subscription and immediately bills the first period', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: true,
      });
      prisma.foodPlan.findFirst.mockResolvedValue(activePlan);
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(null);
      prisma.tenantFoodSubscription.create.mockResolvedValue({
        id: 'sub-1',
        priceSnapshot: activePlan.price,
        currency: 'INR',
        mealTypesSnapshot: activePlan.mealTypes,
      });

      const result = await service.subscribe(buildUser(), {
        foodPlanId: 'plan-1',
      });
      expect(result.id).toBe('sub-1');
      expect(billing.generateInvoiceForPeriod).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'FOOD_SUBSCRIPTION_CREATED',
          entityType: 'TenantFoodSubscription',
          entityId: 'sub-1',
          organizationId: 'org-1',
          metadata: expect.objectContaining({ foodPlanId: 'plan-1' }),
        }),
      );
    });

    it('rejects when optional subscriptions are disabled at the property', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: false,
      });

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.FOOD_NOT_ENABLED });
    });

    it('rejects subscribing to an INACTIVE plan', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: true,
      });
      prisma.foodPlan.findFirst.mockResolvedValue({
        ...activePlan,
        status: 'ARCHIVED',
      });

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.FOOD_PLAN_INACTIVE });
    });

    it('rejects a second active subscription for the same residency (pre-check)', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: true,
      });
      prisma.foodPlan.findFirst.mockResolvedValue(activePlan);
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FOOD_SUBSCRIPTION_ALREADY_ACTIVE,
      });
    });

    it('treats a PAUSED subscription as existing too (no second plan beside a paused one)', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: true,
      });
      prisma.foodPlan.findFirst.mockResolvedValue(activePlan);
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue({
        id: 'paused-one',
        status: 'PAUSED',
      });

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FOOD_SUBSCRIPTION_ALREADY_ACTIVE,
      });
      expect(prisma.tenantFoodSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE', 'PAUSED'] },
          }),
        }),
      );
      expect(prisma.tenantFoodSubscription.create).not.toHaveBeenCalled();
    });

    it('translates a lost concurrency race (unique violation) into the same conflict', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        optionalSubscriptionEnabled: true,
      });
      prisma.foodPlan.findFirst.mockResolvedValue(activePlan);
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(null);
      prisma.tenantFoodSubscription.create.mockRejectedValue(
        p2002('food_subscriptions_active_residency_unique'),
      );

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({
        code: ErrorCode.FOOD_SUBSCRIPTION_ALREADY_ACTIVE,
      });
    });

    it('rejects when the organization subscription is suspended (never for SUPER_ADMIN)', async () => {
      saasSubscriptions.isOrganizationWriteBlocked.mockResolvedValue(true);

      await expect(
        service.subscribe(buildUser(), { foodPlanId: 'plan-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.SUBSCRIPTION_SUSPENDED });
    });
  });

  describe('pause / resume / cancel', () => {
    function buildSubscription(overrides: Partial<any> = {}) {
      return {
        id: 'sub-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        tenantId: 'tenant-1',
        residencyId: 'res-1',
        foodPlanId: 'plan-1',
        status: 'ACTIVE',
        startDate: new Date('2026-09-01'),
        endDate: null,
        priceSnapshot: new Prisma.Decimal('2500.00'),
        currency: 'INR',
        mealTypesSnapshot: ['LUNCH', 'DINNER'],
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
        tenant: { userId: 'user-1' },
        ...overrides,
      };
    }

    it('pauses an ACTIVE subscription', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(
        buildSubscription(),
      );
      prisma.tenantFoodSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.tenantFoodSubscription.findUniqueOrThrow.mockResolvedValue(
        buildSubscription({ status: 'PAUSED' }),
      );

      const result = await service.pause(buildUser(), 'sub-1');
      expect(result.status).toBe('PAUSED');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_SUBSCRIPTION_PAUSED',
          entityId: 'sub-1',
        }),
      );
    });

    it('rejects pausing an already-PAUSED subscription (lost race -> count 0)', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(
        buildSubscription({ status: 'PAUSED' }),
      );
      prisma.tenantFoodSubscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.pause(buildUser(), 'sub-1')).rejects.toMatchObject({
        code: ErrorCode.INVALID_FOOD_SUBSCRIPTION_STATE,
      });
    });

    it('resumes a PAUSED subscription', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(
        buildSubscription({ status: 'PAUSED' }),
      );
      prisma.tenantFoodSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.tenantFoodSubscription.findUniqueOrThrow.mockResolvedValue(
        buildSubscription(),
      );

      const result = await service.resume(buildUser(), 'sub-1');
      expect(result.status).toBe('ACTIVE');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_SUBSCRIPTION_RESUMED',
          entityId: 'sub-1',
        }),
      );
    });

    it('the subscribing tenant can cancel their own subscription', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(
        buildSubscription(),
      );
      prisma.tenantFoodSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.tenantFoodSubscription.findUniqueOrThrow.mockResolvedValue(
        buildSubscription({ status: 'CANCELLED' }),
      );

      const result = await service.cancel(buildUser(), 'sub-1');
      expect(result.status).toBe('CANCELLED');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FOOD_SUBSCRIPTION_CANCELLED',
          entityId: 'sub-1',
        }),
      );
    });

    it('an unrelated user gets 404, not a state error (BOLA), and writes no audit row', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(
        buildSubscription({ tenant: { userId: 'someone-else' } }),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.cancel(buildUser({ id: 'outsider' }), 'sub-1'),
      ).rejects.toMatchObject({ code: ErrorCode.FOOD_SUBSCRIPTION_NOT_FOUND });
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('cancelForCheckout', () => {
    it('expires an ACTIVE/PAUSED subscription for the residency, never fails when none exists', async () => {
      const tx = {
        tenantFoodSubscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      await service.cancelForCheckout(tx as any, 'res-1');
      expect(tx.tenantFoodSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { residencyId: 'res-1', status: { in: ['ACTIVE', 'PAUSED'] } },
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });
  });
  describe('findMyActive', () => {
    it('returns a PAUSED subscription so the tenant can see and resume it', async () => {
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        propertyId: 'property-1',
        tenantId: 'tenant-1',
        residencyId: 'residency-1',
        foodPlanId: 'plan-1',
        status: 'PAUSED',
        startDate: new Date('2026-09-01'),
        endDate: null,
        priceSnapshot: new Prisma.Decimal('1500.00'),
        currency: 'INR',
        mealTypesSnapshot: ['LUNCH'],
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
      });

      const result = await service.findMyActive(buildUser());

      expect(result?.status).toBe('PAUSED');
      expect(prisma.tenantFoodSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE', 'PAUSED'] },
          }),
        }),
      );
    });
  });
});
