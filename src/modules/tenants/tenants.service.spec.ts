import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { TenantsService } from './tenants.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: {
    tenant: { create: jest.Mock; findUnique: jest.Mock };
    residency: { findFirst: jest.Mock };
  };
  let memberships: { listActiveOrganizationIds: jest.Mock };

  beforeEach(() => {
    prisma = {
      tenant: { create: jest.fn(), findUnique: jest.fn() },
      residency: { findFirst: jest.fn() },
    };
    memberships = { listActiveOrganizationIds: jest.fn() };
    service = new TenantsService(
      prisma as any,
      memberships as unknown as MembershipsService,
    );
  });

  describe('createForSelf', () => {
    it('creates a tenant with userId always taken from the authenticated caller', async () => {
      prisma.tenant.create.mockResolvedValue({
        id: 'tenant-1',
        userId: 'user-1',
        createdAt: new Date(),
      });

      const result = await service.createForSelf(buildUser());

      expect(prisma.tenant.create).toHaveBeenCalledWith({
        data: { userId: 'user-1' },
      });
      expect(result.userId).toBe('user-1');
    });
  });

  describe('findOne', () => {
    it('throws TENANT_NOT_FOUND when the tenant does not exist', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'missing-tenant'),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
    });

    it("allows the tenant's own user to read it", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        userId: 'user-1',
        createdAt: new Date(),
      });

      const result = await service.findOne(buildUser(), 'tenant-1');

      expect(result.id).toBe('tenant-1');
      expect(memberships.listActiveOrganizationIds).not.toHaveBeenCalled();
    });

    it('allows a SUPER_ADMIN to read any tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        userId: 'someone-else',
        createdAt: new Date(),
      });

      const result = await service.findOne(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        'tenant-1',
      );

      expect(result.id).toBe('tenant-1');
    });

    it('allows an org member who shares a residency with this tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        userId: 'someone-else',
        createdAt: new Date(),
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.residency.findFirst.mockResolvedValue({ id: 'res-1' });

      const result = await service.findOne(buildUser(), 'tenant-1');

      expect(result.id).toBe('tenant-1');
      expect(prisma.residency.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          property: { organizationId: { in: ['org-1'] } },
        },
      });
    });

    it('rejects (404, hiding existence) an unrelated caller with no shared residency', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        userId: 'someone-else',
        createdAt: new Date(),
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.residency.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'tenant-1'),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
    });
  });

  describe('assertExists', () => {
    it('throws TENANT_NOT_FOUND for a nonexistent tenantId', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.assertExists('missing')).rejects.toMatchObject({
        code: ErrorCode.TENANT_NOT_FOUND,
      });
    });

    it('returns the tenant when it exists, without any access check', async () => {
      const tenant = {
        id: 'tenant-1',
        userId: 'user-9',
        createdAt: new Date(),
      };
      prisma.tenant.findUnique.mockResolvedValue(tenant);

      await expect(service.assertExists('tenant-1')).resolves.toBe(tenant);
    });
  });
});
