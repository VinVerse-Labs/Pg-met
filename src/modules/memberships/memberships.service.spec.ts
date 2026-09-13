import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from './memberships.service';

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

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    organizationMembership: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn() },
      organizationMembership: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    service = new MembershipsService(prisma as any);
  });

  describe('assertOrganizationAccess', () => {
    it('throws ORGANIZATION_NOT_FOUND when the organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.assertOrganizationAccess(buildUser(), 'org-missing'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
    });

    it('throws the SAME ORGANIZATION_NOT_FOUND when the org exists but the user is not an active member', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'ACTIVE',
      });
      prisma.organizationMembership.findFirst.mockResolvedValue(null);

      await expect(
        service.assertOrganizationAccess(buildUser(), 'org-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
    });

    it('grants a SUPER_ADMIN access without requiring a membership row', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'ACTIVE',
      });

      const result = await service.assertOrganizationAccess(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        'org-1',
      );

      expect(result.membership).toBeNull();
      expect(prisma.organizationMembership.findFirst).not.toHaveBeenCalled();
    });

    it('throws ORGANIZATION_SUSPENDED for a suspended organization, even for an active member', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'SUSPENDED',
      });
      prisma.organizationMembership.findFirst.mockResolvedValue({
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await expect(
        service.assertOrganizationAccess(buildUser(), 'org-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_SUSPENDED });
    });

    it('blocks a SUPER_ADMIN from a suspended organization too', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'SUSPENDED',
      });

      await expect(
        service.assertOrganizationAccess(
          buildUser({ platformRole: 'SUPER_ADMIN' }),
          'org-1',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_SUSPENDED });
    });

    it('returns the membership for a normal active member of an active organization', async () => {
      const membership = { role: 'MANAGER', status: 'ACTIVE' };
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'ACTIVE',
      });
      prisma.organizationMembership.findFirst.mockResolvedValue(membership);

      const result = await service.assertOrganizationAccess(
        buildUser(),
        'org-1',
      );

      expect(result.membership).toBe(membership);
    });
  });

  describe('assertRole', () => {
    it('allows a SUPER_ADMIN regardless of membership/role', () => {
      expect(() =>
        service.assertRole(buildUser({ platformRole: 'SUPER_ADMIN' }), null, [
          'OWNER',
        ]),
      ).not.toThrow();
    });

    it('throws INSUFFICIENT_ROLE when there is no membership at all', () => {
      expect(() => service.assertRole(buildUser(), null, ['OWNER'])).toThrow(
        expect.objectContaining({ code: ErrorCode.INSUFFICIENT_ROLE }),
      );
    });

    it('throws INSUFFICIENT_ROLE when the role is not in the allowed list', () => {
      expect(() =>
        service.assertRole(buildUser(), { role: 'STAFF' } as any, [
          'OWNER',
          'MANAGER',
        ]),
      ).toThrow(expect.objectContaining({ code: ErrorCode.INSUFFICIENT_ROLE }));
    });

    it('allows a role that IS in the allowed list', () => {
      expect(() =>
        service.assertRole(buildUser(), { role: 'MANAGER' } as any, [
          'OWNER',
          'MANAGER',
        ]),
      ).not.toThrow();
    });
  });

  describe('listActiveOrganizationIds', () => {
    it('returns only the organizationIds of ACTIVE memberships', async () => {
      prisma.organizationMembership.findMany.mockResolvedValue([
        { organizationId: 'org-1' },
        { organizationId: 'org-2' },
      ]);

      const result = await service.listActiveOrganizationIds('user-1');

      expect(result).toEqual(['org-1', 'org-2']);
      expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'ACTIVE' },
        }),
      );
    });
  });
});
