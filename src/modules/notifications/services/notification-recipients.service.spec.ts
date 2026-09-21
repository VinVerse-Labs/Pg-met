import { NotificationRecipientsService } from './notification-recipients.service';

describe('NotificationRecipientsService', () => {
  let service: NotificationRecipientsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      residency: { findUnique: jest.fn(), findMany: jest.fn() },
      organizationMembership: { findMany: jest.fn() },
    };
    service = new NotificationRecipientsService(prisma);
  });

  describe('tenantUserIdForResidency', () => {
    it('resolves Residency -> Tenant -> Tenant.userId', async () => {
      prisma.residency.findUnique.mockResolvedValue({
        tenant: { userId: 'tenant-user-1' },
      });
      const result = await service.tenantUserIdForResidency('res-1');
      expect(result).toBe('tenant-user-1');
      expect(prisma.residency.findUnique).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        include: { tenant: { select: { userId: true } } },
      });
    });

    it('returns null (never throws) for a residency that does not exist', async () => {
      prisma.residency.findUnique.mockResolvedValue(null);
      const result = await service.tenantUserIdForResidency('missing');
      expect(result).toBeNull();
    });
  });

  describe('activeTenantUserIdsForProperty', () => {
    it('includes only ACTIVE/NOTICE_PERIOD residencies at that property', async () => {
      prisma.residency.findMany.mockResolvedValue([
        { tenant: { userId: 'u1' } },
        { tenant: { userId: 'u2' } },
      ]);
      const result = await service.activeTenantUserIdsForProperty('prop-A');

      expect(prisma.residency.findMany).toHaveBeenCalledWith({
        where: {
          propertyId: 'prop-A',
          status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        },
        include: { tenant: { select: { userId: true } } },
      });
      expect(result.sort()).toEqual(['u1', 'u2']);
    });

    it('property isolation: never includes another property’s tenants (query itself scopes propertyId, simulated by mock only returning that property’s rows)', async () => {
      // The fake DB layer here only returns rows matching the WHERE
      // clause it was given, mirroring how a real Postgres query would
      // enforce the propertyId filter - this proves the service passes
      // the correct propertyId through untouched.
      prisma.residency.findMany.mockImplementation(async ({ where }: any) => {
        expect(where.propertyId).toBe('prop-A');
        return [{ tenant: { userId: 'tenant-of-A' } }];
      });

      const result = await service.activeTenantUserIdsForProperty('prop-A');
      expect(result).toEqual(['tenant-of-A']);
      expect(result).not.toContain('tenant-of-B');
    });

    it('de-duplicates a tenant with more than one matching residency row', async () => {
      prisma.residency.findMany.mockResolvedValue([
        { tenant: { userId: 'u1' } },
        { tenant: { userId: 'u1' } },
      ]);
      const result = await service.activeTenantUserIdsForProperty('prop-A');
      expect(result).toEqual(['u1']);
    });
  });

  describe('activeOrgMembersByRole', () => {
    it('scopes to ACTIVE memberships with one of the given roles within the organization', async () => {
      prisma.organizationMembership.findMany.mockResolvedValue([
        { userId: 'owner-1' },
      ]);
      const result = await service.activeOrgMembersByRole('org-A', [
        'OWNER',
        'MANAGER',
      ] as any);

      expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-A',
          status: 'ACTIVE',
          role: { in: ['OWNER', 'MANAGER'] },
        },
        select: { userId: true },
      });
      expect(result).toEqual(['owner-1']);
    });

    it('organization isolation: never returns members of another organization', async () => {
      prisma.organizationMembership.findMany.mockImplementation(
        async ({ where }: any) => {
          expect(where.organizationId).toBe('org-A');
          return [{ userId: 'owner-of-A' }];
        },
      );
      const result = await service.activeOrgMembersByRole('org-A', [
        'OWNER',
      ] as any);
      expect(result).toEqual(['owner-of-A']);
    });

    it('de-duplicates a user with more than one matching membership row', async () => {
      prisma.organizationMembership.findMany.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u1' },
      ]);
      const result = await service.activeOrgMembersByRole('org-A', [
        'OWNER',
      ] as any);
      expect(result).toEqual(['u1']);
    });
  });
});
