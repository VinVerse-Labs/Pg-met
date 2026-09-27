import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { TenantsService } from './tenants.service';
import { tenantCodeFromId } from './tenant-code';

const TENANT_ID = '8f3c2a1b-9e44-4c1d-8a2b-1234567890ab';
const CODE = tenantCodeFromId(TENANT_ID);

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Asha Owner',
    email: 'owner@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

describe('TenantsService - tenant codes', () => {
  let service: TenantsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn(), findMany: jest.fn() },
      organizationMembership: { findFirst: jest.fn() },
    };
    service = new TenantsService(prisma, {} as unknown as MembershipsService);
  });

  describe('findMine', () => {
    it("returns the caller's own tenant profile, including its short code", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: TENANT_ID,
        userId: 'user-1',
        createdAt: new Date(),
      });
      await expect(service.findMine(buildUser())).resolves.toMatchObject({
        id: TENANT_ID,
        code: CODE,
      });
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('404s TENANT_NOT_FOUND when the caller has no tenant profile', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.findMine(buildUser())).rejects.toMatchObject({
        code: ErrorCode.TENANT_NOT_FOUND,
      });
    });
  });

  describe('lookupByCode', () => {
    beforeEach(() => {
      prisma.organizationMembership.findFirst.mockResolvedValue({ id: 'm-1' });
    });

    it('resolves a code to the tenant id and account name only', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, user: { name: 'Priya Tenant' } },
      ]);
      const result = await service.lookupByCode(
        buildUser(),
        CODE.toLowerCase(),
      );
      expect(result).toEqual({
        tenantId: TENANT_ID,
        code: CODE,
        name: 'Priya Tenant',
      });
      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { startsWith: TENANT_ID.slice(0, 11) } },
          select: { id: true, user: { select: { name: true } } },
        }),
      );
    });

    it('only lets an active OWNER/MANAGER look up codes (404 otherwise, never revealing matches)', async () => {
      prisma.organizationMembership.findFirst.mockResolvedValue(null);
      await expect(
        service.lookupByCode(buildUser(), CODE),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
      expect(prisma.organizationMembership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            status: 'ACTIVE',
            role: { in: ['OWNER', 'MANAGER'] },
          },
        }),
      );
    });

    it('lets a SUPER_ADMIN look up without a membership', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, user: { name: 'Priya Tenant' } },
      ]);
      await service.lookupByCode(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        CODE,
      );
      expect(prisma.organizationMembership.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a malformed code with VALIDATION_FAILED', async () => {
      await expect(
        service.lookupByCode(buildUser(), 'TN-12'),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('404s an unknown code', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);
      await expect(
        service.lookupByCode(buildUser(), CODE),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
    });

    it('409s TENANT_CODE_AMBIGUOUS instead of guessing when two tenants share a prefix', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, user: { name: 'A' } },
        {
          id: `${TENANT_ID.slice(0, 11)}ff-4000-8000-000000000000`,
          user: { name: 'B' },
        },
      ]);
      await expect(
        service.lookupByCode(buildUser(), CODE),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_CODE_AMBIGUOUS });
    });
  });
});
