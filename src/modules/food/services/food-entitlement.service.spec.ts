import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { FoodConfigurationService } from './food-configuration.service';
import { FoodEntitlementService } from './food-entitlement.service';

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

describe('FoodEntitlementService', () => {
  let service: FoodEntitlementService;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    residency: { findFirst: jest.Mock };
    tenantFoodSubscription: { findFirst: jest.Mock };
  };
  let foodConfiguration: { getOrCreate: jest.Mock };

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      residency: { findFirst: jest.fn() },
      tenantFoodSubscription: { findFirst: jest.fn() },
    };
    foodConfiguration = { getOrCreate: jest.fn() };
    service = new FoodEntitlementService(
      prisma as any,
      foodConfiguration as unknown as FoodConfigurationService,
    );
  });

  describe('getCallerResidencyContext', () => {
    it('throws TENANT_NOT_FOUND when the caller has no tenant profile', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.getCallerResidencyContext(buildUser()),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
    });

    it('throws RESIDENCY_NOT_FOUND when the tenant has no current residency', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue(null);
      await expect(
        service.getCallerResidencyContext(buildUser()),
      ).rejects.toMatchObject({ code: ErrorCode.RESIDENCY_NOT_FOUND });
    });
  });

  describe('getEntitlementForResidency', () => {
    it('returns empty entitlement when food is disabled', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({ enabled: false });
      const result = await service.getEntitlementForResidency(
        'org-1',
        'prop-1',
        'res-1',
      );
      expect(result.includedMeals).toEqual([]);
      expect(result.subscriptionMeals).toEqual([]);
    });

    it('Model A: meals included in rent, no subscription needed', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        mealsIncludedInRent: true,
        includedMealTypes: ['BREAKFAST', 'LUNCH', 'DINNER'],
        optionalSubscriptionEnabled: false,
      });
      const result = await service.getEntitlementForResidency(
        'org-1',
        'prop-1',
        'res-1',
      );
      expect(result.includedMeals).toEqual(['BREAKFAST', 'LUNCH', 'DINNER']);
      expect(result.subscriptionMeals).toEqual([]);
      expect(prisma.tenantFoodSubscription.findFirst).not.toHaveBeenCalled();
    });

    it('Model B: optional subscription only, no meals included in rent', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        mealsIncludedInRent: false,
        includedMealTypes: [],
        optionalSubscriptionEnabled: true,
      });
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue({
        mealTypesSnapshot: ['LUNCH', 'DINNER'],
      });
      const result = await service.getEntitlementForResidency(
        'org-1',
        'prop-1',
        'res-1',
      );
      expect(result.includedMeals).toEqual([]);
      expect(result.subscriptionMeals).toEqual(['LUNCH', 'DINNER']);
    });

    it('Model C: breakfast included in rent, lunch+dinner via subscription, never duplicated', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        mealsIncludedInRent: true,
        includedMealTypes: ['BREAKFAST'],
        optionalSubscriptionEnabled: true,
      });
      // Plan nominally covers all three, but BREAKFAST is already
      // rent-included - must never appear in both arrays.
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue({
        mealTypesSnapshot: ['BREAKFAST', 'LUNCH', 'DINNER'],
      });
      const result = await service.getEntitlementForResidency(
        'org-1',
        'prop-1',
        'res-1',
      );
      expect(result.includedMeals).toEqual(['BREAKFAST']);
      expect(result.subscriptionMeals).toEqual(['LUNCH', 'DINNER']);
    });

    it('no active subscription -> subscriptionMeals is empty even if the config allows it', async () => {
      foodConfiguration.getOrCreate.mockResolvedValue({
        enabled: true,
        mealsIncludedInRent: false,
        includedMealTypes: [],
        optionalSubscriptionEnabled: true,
      });
      prisma.tenantFoodSubscription.findFirst.mockResolvedValue(null);
      const result = await service.getEntitlementForResidency(
        'org-1',
        'prop-1',
        'res-1',
      );
      expect(result.subscriptionMeals).toEqual([]);
    });
  });
});
