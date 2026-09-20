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
  let prisma: { saasPlan: { findMany: jest.Mock; findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { saasPlan: { findMany: jest.fn(), findFirst: jest.fn() } };
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
});
