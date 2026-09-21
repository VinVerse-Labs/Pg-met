import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { ComplaintsService } from './complaints.service';

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

describe('ComplaintsService', () => {
  let service: ComplaintsService;
  let prisma: any;
  let memberships: {
    getActiveMembership: jest.Mock;
    listActiveOrganizationIds: jest.Mock;
  };
  let subscriptions: { isOrganizationWriteBlocked: jest.Mock };
  let activity: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      residency: { findFirst: jest.fn() },
      room: { findFirst: jest.fn() },
      bed: { findFirst: jest.fn() },
      bedAllocation: { findFirst: jest.fn() },
      complaint: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    memberships = {
      getActiveMembership: jest.fn(),
      listActiveOrganizationIds: jest.fn(),
    };
    subscriptions = {
      isOrganizationWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    activity = { record: jest.fn() };

    service = new ComplaintsService(
      prisma,
      memberships as unknown as MembershipsService,
      subscriptions as unknown as SubscriptionsService,
      activity as unknown as ComplaintActivityService,
    );
  });

  describe('create', () => {
    function mockTx() {
      const tx = {
        complaint: {
          create: jest.fn().mockResolvedValue({
            id: 'complaint-1',
            status: 'OPEN',
            organizationId: 'org-1',
          }),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('derives organizationId/tenantId/residencyId from the caller’s current residency', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        userId: 'user-1',
      });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      prisma.bedAllocation.findFirst.mockResolvedValue(null);
      const tx = mockTx();

      await service.create(buildUser(), {
        propertyId: 'prop-1',
        category: 'PLUMBING',
        title: 'Leaking tap',
        description: 'The tap is leaking',
      } as any);

      expect(tx.complaint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            residencyId: 'res-1',
            tenantId: 'tenant-1',
            reportedByUserId: 'user-1',
          }),
        }),
      );
    });

    it('rejects a tenant with no current (ACTIVE/NOTICE_PERIOD) residency at the property', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildUser(), {
          propertyId: 'prop-1',
          category: 'PLUMBING',
          title: 'Leaking tap',
          description: 'x',
        } as any),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INVALID_RESIDENCY_CONTEXT,
      });
    });

    it('rejects a room that does not belong to the given property', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      prisma.room.findFirst.mockResolvedValue(null);

      await expect(
        service.create(buildUser(), {
          propertyId: 'prop-1',
          roomId: 'room-from-another-property',
          category: 'ROOM',
          title: 'x',
          description: 'x',
        } as any),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });

    it('caps a tenant-supplied URGENT priority down to HIGH', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      prisma.bedAllocation.findFirst.mockResolvedValue(null);
      const tx = mockTx();

      await service.create(buildUser(), {
        propertyId: 'prop-1',
        category: 'OTHER',
        priority: 'URGENT',
        title: 'x',
        description: 'x',
      } as any);

      expect(tx.complaint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'HIGH' }),
        }),
      );
    });

    it('derives room/bed from the active BedAllocation when neither is supplied', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      prisma.bedAllocation.findFirst.mockResolvedValue({
        bedId: 'bed-1',
        bed: { roomId: 'room-1' },
      });
      const tx = mockTx();

      await service.create(buildUser(), {
        propertyId: 'prop-1',
        category: 'OTHER',
        title: 'x',
        description: 'x',
      } as any);

      expect(tx.complaint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roomId: 'room-1', bedId: 'bed-1' }),
        }),
      );
    });

    it('rejects creation when the organization’s subscription is write-blocked', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      subscriptions.isOrganizationWriteBlocked.mockResolvedValue(true);

      await expect(
        service.create(buildUser(), {
          propertyId: 'prop-1',
          category: 'OTHER',
          title: 'x',
          description: 'x',
        } as any),
      ).rejects.toMatchObject({ code: ErrorCode.SUBSCRIPTION_SUSPENDED });
    });

    it('SUPER_ADMIN bypasses the subscription-blocked check', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        property: { organizationId: 'org-1' },
      });
      prisma.bedAllocation.findFirst.mockResolvedValue(null);
      subscriptions.isOrganizationWriteBlocked.mockResolvedValue(true);
      mockTx();

      await service.create(buildUser({ platformRole: 'SUPER_ADMIN' }), {
        propertyId: 'prop-1',
        category: 'OTHER',
        title: 'x',
        description: 'x',
      } as any);

      expect(subscriptions.isOrganizationWriteBlocked).not.toHaveBeenCalled();
    });
  });

  describe('getAccessibleComplaintOrThrow (BOLA)', () => {
    it('allows the reporting tenant', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
        tenant: { userId: 'user-1' },
      });
      const result = await service.getAccessibleComplaintOrThrow(
        buildUser(),
        'c1',
      );
      expect(result.id).toBe('c1');
    });

    it('allows an active organization member', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
        tenant: { userId: 'someone-else' },
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      const result = await service.getAccessibleComplaintOrThrow(
        buildUser(),
        'c1',
      );
      expect(result.id).toBe('c1');
    });

    it('rejects an unrelated tenant (cross-tenant BOLA)', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
        tenant: { userId: 'someone-else' },
      });
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.getAccessibleComplaintOrThrow(buildUser(), 'c1'),
      ).rejects.toMatchObject({ code: ErrorCode.COMPLAINT_NOT_FOUND });
    });

    it('SUPER_ADMIN can access any complaint', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
        tenant: { userId: 'someone-else' },
      });
      const result = await service.getAccessibleComplaintOrThrow(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        'c1',
      );
      expect(result.id).toBe('c1');
    });
  });

  describe('getOrgComplaintForActionOrThrow', () => {
    it('rejects a tenant (never reachable for org-write actions)', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.getOrgComplaintForActionOrThrow(buildUser(), 'c1', [
          'OWNER',
          'MANAGER',
        ]),
      ).rejects.toMatchObject({ code: ErrorCode.COMPLAINT_NOT_FOUND });
    });

    it('rejects a role not in the allowed list', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });

      await expect(
        service.getOrgComplaintForActionOrThrow(buildUser(), 'c1', [
          'OWNER',
          'MANAGER',
        ]),
      ).rejects.toMatchObject({ code: ErrorCode.COMPLAINT_NOT_FOUND });
    });

    it('allows an allowed role', async () => {
      prisma.complaint.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });

      const result = await service.getOrgComplaintForActionOrThrow(
        buildUser(),
        'c1',
        ['OWNER', 'MANAGER'],
      );
      expect(result.id).toBe('c1');
    });
  });

  describe('findMany scoping', () => {
    it('scopes a pure tenant (no memberships) to their own complaints only', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      memberships.listActiveOrganizationIds.mockResolvedValue([]);
      prisma.complaint.findMany.mockResolvedValue([]);
      prisma.complaint.count.mockResolvedValue(0);

      await service.findMany(buildUser(), { page: 1, limit: 20 } as any);

      const call = prisma.complaint.findMany.mock.calls[0][0];
      expect(call.where.tenantId).toBe('tenant-1');
    });

    it('scopes an organization member to their organizations', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      memberships.listActiveOrganizationIds.mockResolvedValue([
        'org-1',
        'org-2',
      ]);
      prisma.complaint.findMany.mockResolvedValue([]);
      prisma.complaint.count.mockResolvedValue(0);

      await service.findMany(buildUser(), { page: 1, limit: 20 } as any);

      const call = prisma.complaint.findMany.mock.calls[0][0];
      expect(call.where.organizationId).toEqual({ in: ['org-1', 'org-2'] });
    });

    it('SUPER_ADMIN sees the platform, unscoped', async () => {
      prisma.complaint.findMany.mockResolvedValue([]);
      prisma.complaint.count.mockResolvedValue(0);

      await service.findMany(buildUser({ platformRole: 'SUPER_ADMIN' }), {
        page: 1,
        limit: 20,
      } as any);

      const call = prisma.complaint.findMany.mock.calls[0][0];
      expect(call.where.tenantId).toBeUndefined();
      expect(call.where.organizationId).toBeUndefined();
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
  });
});
