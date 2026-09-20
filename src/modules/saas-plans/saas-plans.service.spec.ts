import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { SaasPlansService } from './saas-plans.service';

function buildPlan(overrides: Partial<any> = {}) {
  return {
    id: 'plan-1',
    name: 'Basic',
    description: 'Default plan',
    price: new Prisma.Decimal('499.00'),
    currency: 'INR',
    billingInterval: 'MONTHLY',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('SaasPlansService', () => {
  let service: SaasPlansService;
  let prisma: {
    saasPlan: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      saasPlan: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new SaasPlansService(prisma as any);
  });

  describe('findActive', () => {
    it('returns only active plans, serialized with a decimal-string price', async () => {
      prisma.saasPlan.findMany.mockResolvedValue([buildPlan()]);

      const result = await service.findActive();
      expect(prisma.saasPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'ACTIVE' } }),
      );
      expect(result[0].price).toBe('499');
    });
  });

  describe('getDefaultActivePlan', () => {
    it('returns the oldest active plan', async () => {
      prisma.saasPlan.findFirst.mockResolvedValue(buildPlan());
      const plan = await service.getDefaultActivePlan();
      expect(plan.id).toBe('plan-1');
    });

    it('throws SAAS_PLAN_NOT_FOUND when no active plan exists', async () => {
      prisma.saasPlan.findFirst.mockResolvedValue(null);
      await expect(service.getDefaultActivePlan()).rejects.toMatchObject({
        code: ErrorCode.SAAS_PLAN_NOT_FOUND,
      });
    });
  });

  describe('getActiveByIdOrThrow', () => {
    it('returns the plan when active', async () => {
      prisma.saasPlan.findFirst.mockResolvedValue(buildPlan({ id: 'plan-2' }));
      const plan = await service.getActiveByIdOrThrow('plan-2');
      expect(plan.id).toBe('plan-2');
    });

    it('throws SAAS_PLAN_NOT_FOUND for an inactive or unknown plan', async () => {
      prisma.saasPlan.findFirst.mockResolvedValue(null);
      await expect(service.getActiveByIdOrThrow('nope')).rejects.toMatchObject({
        code: ErrorCode.SAAS_PLAN_NOT_FOUND,
      });
    });
  });

  describe('adminCreate', () => {
    it('creates a new plan row with the given price - never mutates an existing one', async () => {
      prisma.saasPlan.create.mockResolvedValue(
        buildPlan({
          id: 'plan-new',
          name: 'Pro',
          price: new Prisma.Decimal('999.00'),
        }),
      );

      const result = await service.adminCreate({
        name: 'Pro',
        price: '999.00',
      });

      expect(prisma.saasPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Pro',
            price: expect.any(Prisma.Decimal),
          }),
        }),
      );
      expect(result.price).toBe('999');
    });
  });

  describe('adminUpdate', () => {
    it('updates only name/description - the update call never includes price/currency', async () => {
      prisma.saasPlan.findUnique.mockResolvedValue(buildPlan());
      prisma.saasPlan.update.mockResolvedValue(
        buildPlan({ name: 'Basic Renamed' }),
      );

      await service.adminUpdate('plan-1', { name: 'Basic Renamed' });

      expect(prisma.saasPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { name: 'Basic Renamed', description: undefined },
      });
    });

    it('throws SAAS_PLAN_NOT_FOUND for an unknown plan', async () => {
      prisma.saasPlan.findUnique.mockResolvedValue(null);
      await expect(
        service.adminUpdate('nope', { name: 'X' }),
      ).rejects.toMatchObject({ code: ErrorCode.SAAS_PLAN_NOT_FOUND });
    });
  });

  describe('adminDeactivate', () => {
    it('deactivates an active plan', async () => {
      prisma.saasPlan.findUnique.mockResolvedValue(buildPlan());
      prisma.saasPlan.update.mockResolvedValue(
        buildPlan({ status: 'INACTIVE' }),
      );

      const result = await service.adminDeactivate('plan-1');
      expect(result.status).toBe('INACTIVE');
    });

    it('rejects deactivating an already-inactive plan', async () => {
      prisma.saasPlan.findUnique.mockResolvedValue(
        buildPlan({ status: 'INACTIVE' }),
      );

      await expect(service.adminDeactivate('plan-1')).rejects.toMatchObject({
        code: ErrorCode.SAAS_PLAN_ALREADY_INACTIVE,
      });
      expect(prisma.saasPlan.update).not.toHaveBeenCalled();
    });
  });
});
