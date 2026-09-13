import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrganizationsService } from './organizations.service';

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

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    $transaction: jest.Mock;
    organization: { findMany: jest.Mock; update: jest.Mock };
    organizationMembership: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      organization: { findMany: jest.fn(), update: jest.fn() },
      organizationMembership: { findMany: jest.fn() },
    };
    service = new OrganizationsService(prisma as any);
  });

  describe('create', () => {
    it('creates the organization and an OWNER membership atomically', async () => {
      const orgCreate = jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'ABC Living',
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      const membershipCreate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          organization: { create: orgCreate },
          organizationMembership: { create: membershipCreate },
        }),
      );

      const result = await service.create(buildUser(), { name: 'ABC Living' });

      expect(orgCreate).toHaveBeenCalledWith({ data: { name: 'ABC Living' } });
      expect(membershipCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          organizationId: 'org-1',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      expect(result.yourRole).toBe('OWNER');
      expect(result.id).toBe('org-1');
    });

    it('propagates a rollback if membership creation fails (no orphaned organization)', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          organization: {
            create: jest.fn().mockResolvedValue({ id: 'org-1' }),
          },
          organizationMembership: {
            create: jest.fn().mockRejectedValue(new Error('db exploded')),
          },
        }),
      );

      await expect(
        service.create(buildUser(), { name: 'ABC Living' }),
      ).rejects.toThrow('db exploded');
    });
  });

  describe('findAccessible', () => {
    it('returns only organizations where the user has an ACTIVE membership', async () => {
      prisma.organizationMembership.findMany.mockResolvedValue([
        {
          role: 'MANAGER',
          organization: {
            id: 'org-1',
            name: 'A',
            status: 'ACTIVE',
            createdAt: new Date(),
          },
        },
      ]);

      const result = await service.findAccessible(buildUser());

      expect(result).toHaveLength(1);
      expect(result[0].yourRole).toBe('MANAGER');
      expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'ACTIVE' },
        }),
      );
      expect(prisma.organization.findMany).not.toHaveBeenCalled();
    });

    it('returns every organization for a SUPER_ADMIN, bypassing membership', async () => {
      prisma.organization.findMany.mockResolvedValue([
        { id: 'org-1', name: 'A', status: 'ACTIVE', createdAt: new Date() },
        { id: 'org-2', name: 'B', status: 'ACTIVE', createdAt: new Date() },
      ]);

      const result = await service.findAccessible(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
      );

      expect(result).toHaveLength(2);
      expect(result[0].yourRole).toBeNull();
      expect(prisma.organizationMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates the organization name', async () => {
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        name: 'New Name',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.update('org-1', { name: 'New Name' }, {
        role: 'OWNER',
      } as any);

      expect(result.name).toBe('New Name');
      expect(result.yourRole).toBe('OWNER');
    });
  });
});
