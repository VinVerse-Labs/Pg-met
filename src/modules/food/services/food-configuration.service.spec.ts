import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { FoodConfigurationService } from './food-configuration.service';

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

describe('FoodConfigurationService', () => {
  let service: FoodConfigurationService;
  let prisma: {
    foodConfiguration: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let memberships: { getActiveMembership: jest.Mock; assertRole: jest.Mock };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      foodConfiguration: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    memberships = { getActiveMembership: jest.fn(), assertRole: jest.fn() };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new FoodConfigurationService(
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

  describe('getOrCreate', () => {
    it('lazily creates a disabled-by-default row when none exists', async () => {
      prisma.foodConfiguration.findUnique.mockResolvedValue(null);
      prisma.foodConfiguration.create.mockResolvedValue({
        id: 'cfg-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        enabled: false,
        mealsIncludedInRent: false,
        includedMealTypes: [],
        optionalSubscriptionEnabled: false,
      });

      const result = await service.getOrCreate('org-1', 'prop-1');
      expect(result.enabled).toBe(false);
      expect(prisma.foodConfiguration.create).toHaveBeenCalled();
    });

    it('returns the existing row without creating a duplicate', async () => {
      prisma.foodConfiguration.findUnique.mockResolvedValue({
        id: 'cfg-1',
        enabled: true,
      });
      const result = await service.getOrCreate('org-1', 'prop-1');
      expect(result.enabled).toBe(true);
      expect(prisma.foodConfiguration.create).not.toHaveBeenCalled();
    });

    it('re-reads the winner’s row when a concurrent create races (unique violation)', async () => {
      prisma.foodConfiguration.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cfg-1', enabled: false });
      prisma.foodConfiguration.create.mockRejectedValue(new Error('duplicate'));

      const result = await service.getOrCreate('org-1', 'prop-1');
      expect(result.id).toBe('cfg-1');
    });
  });

  describe('update', () => {
    it('OWNER/MANAGER can update the configuration', async () => {
      prisma.foodConfiguration.findUnique.mockResolvedValue({ id: 'cfg-1' });
      prisma.foodConfiguration.update.mockResolvedValue({
        id: 'cfg-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        enabled: true,
        mealsIncludedInRent: true,
        includedMealTypes: ['BREAKFAST'],
        optionalSubscriptionEnabled: false,
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });

      const result = await service.update(buildUser(), 'prop-1', {
        enabled: true,
        mealsIncludedInRent: true,
        includedMealTypes: ['BREAKFAST'] as never,
      });
      expect(result.enabled).toBe(true);
      expect(result.includedMealTypes).toEqual(['BREAKFAST']);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          action: 'FOOD_CONFIGURATION_UPDATED',
          entityType: 'FoodConfiguration',
          entityId: 'cfg-1',
          organizationId: 'org-1',
        }),
      );
    });

    it('rejects STAFF from updating the configuration, and writes no audit row', async () => {
      prisma.foodConfiguration.findUnique.mockResolvedValue({ id: 'cfg-1' });
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      memberships.assertRole.mockImplementation(() => {
        throw new Error('INSUFFICIENT_ROLE');
      });

      await expect(
        service.update(buildUser(), 'prop-1', { enabled: true }),
      ).rejects.toThrow();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
