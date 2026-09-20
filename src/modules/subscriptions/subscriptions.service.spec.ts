import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { SaasPlansService } from '../saas-plans/saas-plans.service';
import { SubscriptionInvoicesService } from '../subscription-invoices/subscription-invoices.service';
import { SubscriptionsService } from './subscriptions.service';

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

const utc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d));

function buildPlan(overrides: Partial<any> = {}) {
  return {
    id: 'plan-1',
    name: 'Basic',
    price: new Prisma.Decimal('499.00'),
    currency: 'INR',
    status: 'ACTIVE',
    ...overrides,
  };
}

function buildSubscription(overrides: Partial<any> = {}) {
  return {
    id: 'sub-1',
    organizationId: 'org-1',
    saasPlanId: 'plan-1',
    pendingSaasPlanId: null,
    status: 'ACTIVE',
    startedAt: utc(2026, 1, 1),
    currentPeriodStart: utc(2026, 8, 20),
    currentPeriodEnd: utc(2099, 1, 1),
    nextBillingAt: utc(2099, 1, 1),
    gracePeriodEndsAt: null,
    cancelledAt: null,
    saasPlan: buildPlan(),
    ...overrides,
  };
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: {
    organizationSubscription: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let memberships: {
    assertOrganizationAccess: jest.Mock;
    assertRole: jest.Mock;
  };
  let saasPlans: {
    getDefaultActivePlan: jest.Mock;
    getActiveByIdOrThrow: jest.Mock;
  };
  let subscriptionInvoices: { generateForPeriod: jest.Mock };
  let configService: ConfigService;

  function mockTx(subscription: any) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      organizationSubscription: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockImplementation(({ data }) => ({
          ...subscription,
          ...data,
          saasPlan: subscription.saasPlan,
        })),
      },
      saasPlan: { findUniqueOrThrow: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  beforeEach(() => {
    prisma = {
      organizationSubscription: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    memberships = {
      assertOrganizationAccess: jest.fn(),
      assertRole: jest.fn(),
    };
    saasPlans = {
      getDefaultActivePlan: jest.fn(),
      getActiveByIdOrThrow: jest.fn(),
    };
    subscriptionInvoices = { generateForPeriod: jest.fn() };
    configService = {
      get: jest.fn().mockReturnValue({ trialDays: 30, gracePeriodDays: 7 }),
    } as any;

    memberships.assertOrganizationAccess.mockResolvedValue({
      membership: { role: 'OWNER' },
    });

    service = new SubscriptionsService(
      prisma as any,
      memberships as unknown as MembershipsService,
      saasPlans as unknown as SaasPlansService,
      subscriptionInvoices as unknown as SubscriptionInvoicesService,
      configService,
    );
  });

  describe('getOrCreateForOrganization', () => {
    it('creates a TRIAL subscription on first access', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(null);
      saasPlans.getDefaultActivePlan.mockResolvedValue(buildPlan());
      const created = buildSubscription({ status: 'TRIAL' });
      prisma.organizationSubscription.create.mockResolvedValue(created);
      mockTx(created);

      const result = await service.getOrCreateForOrganization(
        buildUser(),
        'org-1',
      );

      expect(prisma.organizationSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'TRIAL',
            organizationId: 'org-1',
          }),
        }),
      );
      expect(result.status).toBe('TRIAL');
    });

    it('returns the existing subscription without creating a second one', async () => {
      const existing = buildSubscription();
      prisma.organizationSubscription.findUnique.mockResolvedValue(existing);
      mockTx(existing);

      await service.getOrCreateForOrganization(buildUser(), 'org-1');
      expect(prisma.organizationSubscription.create).not.toHaveBeenCalled();
    });

    it('rejects a MANAGER (OWNER-only billing access)', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.getOrCreateForOrganization(buildUser(), 'org-1'),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });
  });

  describe('evaluateLifecycle', () => {
    it('leaves an ACTIVE subscription within its period untouched', async () => {
      const subscription = buildSubscription({
        currentPeriodEnd: utc(2099, 1, 1),
      });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('ACTIVE');
      expect(subscriptionInvoices.generateForPeriod).not.toHaveBeenCalled();
    });

    it('generates the next invoice and moves ACTIVE -> RENEWAL_DUE once the period ends', async () => {
      const subscription = buildSubscription({
        currentPeriodEnd: utc(2020, 1, 1), // long past
      });
      mockTx(subscription);
      subscriptionInvoices.generateForPeriod.mockResolvedValue({ id: 'inv-1' });

      const result = await service.evaluateLifecycle('sub-1');

      expect(subscriptionInvoices.generateForPeriod).toHaveBeenCalled();
      expect(result.status).toBe('RENEWAL_DUE');
    });

    it('applies a pending plan change when generating the next invoice', async () => {
      const subscription = buildSubscription({
        currentPeriodEnd: utc(2020, 1, 1),
        pendingSaasPlanId: 'plan-2',
      });
      const tx = mockTx(subscription);
      tx.saasPlan.findUniqueOrThrow.mockResolvedValue(
        buildPlan({ id: 'plan-2', price: new Prisma.Decimal('999') }),
      );
      subscriptionInvoices.generateForPeriod.mockResolvedValue({ id: 'inv-1' });

      await service.evaluateLifecycle('sub-1');

      expect(subscriptionInvoices.generateForPeriod).toHaveBeenCalledWith(
        expect.anything(),
        'org-1',
        'sub-1',
        expect.objectContaining({ id: 'plan-2' }),
        expect.any(Date),
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('moves RENEWAL_DUE -> GRACE_PERIOD on the next evaluation', async () => {
      const subscription = buildSubscription({ status: 'RENEWAL_DUE' });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('GRACE_PERIOD');
      expect(result.gracePeriodEndsAt).toBeInstanceOf(Date);
    });

    it('moves GRACE_PERIOD -> SUSPENDED once the grace period expires', async () => {
      const subscription = buildSubscription({
        status: 'GRACE_PERIOD',
        gracePeriodEndsAt: utc(2020, 1, 1),
      });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('SUSPENDED');
    });

    it('does not suspend a GRACE_PERIOD subscription before its grace period ends', async () => {
      const subscription = buildSubscription({
        status: 'GRACE_PERIOD',
        gracePeriodEndsAt: utc(2099, 1, 1),
      });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('GRACE_PERIOD');
    });

    it('cancels (instead of renewing) an ACTIVE subscription whose cancellation was requested', async () => {
      const subscription = buildSubscription({
        currentPeriodEnd: utc(2020, 1, 1),
        cancelledAt: utc(2019, 12, 1),
      });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('CANCELLED');
      expect(subscriptionInvoices.generateForPeriod).not.toHaveBeenCalled();
    });

    it('never transitions a CANCELLED subscription', async () => {
      const subscription = buildSubscription({ status: 'CANCELLED' });
      mockTx(subscription);

      const result = await service.evaluateLifecycle('sub-1');
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('changePlan', () => {
    it('sets pendingSaasPlanId without touching the current plan', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(
        buildSubscription(),
      );
      saasPlans.getActiveByIdOrThrow.mockResolvedValue(
        buildPlan({ id: 'plan-2' }),
      );
      const updated = buildSubscription({ pendingSaasPlanId: 'plan-2' });
      prisma.organizationSubscription.update.mockResolvedValue(updated);
      mockTx(updated);

      const result = await service.changePlan(buildUser(), 'org-1', {
        saasPlanId: 'plan-2',
      });

      expect(prisma.organizationSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pendingSaasPlanId: 'plan-2' } }),
      );
      expect(result.plan.id).toBe('plan-1'); // current plan unchanged this period
    });

    it('rejects changing the plan on a cancelled subscription', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(
        buildSubscription({ status: 'CANCELLED' }),
      );

      await expect(
        service.changePlan(buildUser(), 'org-1', { saasPlanId: 'plan-2' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_SUBSCRIPTION_STATE });
    });
  });

  describe('cancel', () => {
    it('marks cancelledAt without immediately changing status', async () => {
      const subscription = buildSubscription();
      prisma.organizationSubscription.findUnique.mockResolvedValue(
        subscription,
      );
      const updated = { ...subscription, cancelledAt: new Date() };
      prisma.organizationSubscription.update.mockResolvedValue(updated);
      mockTx(updated);

      const result = await service.cancel(buildUser(), 'org-1');
      expect(result.status).toBe('ACTIVE');
      expect(result.cancelledAt).not.toBeNull();
    });

    it('rejects cancelling an already-cancelled subscription', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(
        buildSubscription({ status: 'CANCELLED' }),
      );

      await expect(service.cancel(buildUser(), 'org-1')).rejects.toMatchObject({
        code: ErrorCode.INVALID_SUBSCRIPTION_STATE,
      });
    });

    it('rejects a duplicate cancellation request', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(
        buildSubscription({ cancelledAt: new Date() }),
      );

      await expect(service.cancel(buildUser(), 'org-1')).rejects.toMatchObject({
        code: ErrorCode.INVALID_SUBSCRIPTION_STATE,
      });
    });
  });

  describe('activateFromPayment', () => {
    it('extends the period, applies a pending plan, and returns to ACTIVE', async () => {
      const subscription = buildSubscription({
        status: 'GRACE_PERIOD',
        pendingSaasPlanId: 'plan-2',
        gracePeriodEndsAt: utc(2026, 9, 26),
      });
      const tx = {
        organizationSubscription: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(subscription),
          update: jest.fn(),
        },
      };

      await service.activateFromPayment(
        tx as any,
        'sub-1',
        utc(2026, 9, 20),
        utc(2026, 10, 19),
      );

      expect(tx.organizationSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: utc(2026, 9, 20),
          currentPeriodEnd: utc(2026, 10, 19),
          nextBillingAt: utc(2026, 10, 19),
          gracePeriodEndsAt: null,
          saasPlanId: 'plan-2',
          pendingSaasPlanId: null,
        },
      });
    });
  });
});
