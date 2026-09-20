import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PlatformAdminService } from './platform-admin.service';

function buildAdmin(): AuthenticatedUser {
  return {
    id: 'admin-1',
    name: 'Founder',
    email: 'founder@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'SUPER_ADMIN',
  };
}

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let prisma: any;
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      organization: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      room: { count: jest.fn() },
      bed: { count: jest.fn() },
      residency: { findMany: jest.fn(), count: jest.fn() },
      user: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
      property: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      organizationSubscription: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      subscriptionPayment: { findFirst: jest.fn() },
      subscriptionInvoice: { aggregate: jest.fn() },
    };
    auditLog = { record: jest.fn() };
    service = new PlatformAdminService(
      prisma,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('findOrganizations', () => {
    it('paginates and returns list-shaped rows with subscription status flattened', async () => {
      prisma.organization.findMany.mockResolvedValue([
        {
          id: 'org-1',
          name: 'Acme PG',
          status: 'ACTIVE',
          createdAt: new Date(),
          subscription: { status: 'TRIAL' },
          _count: { properties: 2 },
        },
      ]);
      prisma.organization.count.mockResolvedValue(1);

      const result = await service.findOrganizations({ page: 1, limit: 20 });

      expect(result.items[0]).toMatchObject({
        id: 'org-1',
        subscriptionStatus: 'TRIAL',
        propertyCount: 2,
      });
      expect(result.total).toBe(1);
    });

    it('builds a search filter across organization name and OWNER name/email', async () => {
      prisma.organization.findMany.mockResolvedValue([]);
      prisma.organization.count.mockResolvedValue(0);

      await service.findOrganizations({
        page: 1,
        limit: 20,
        search: 'acme',
      } as any);

      const call = prisma.organization.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR[0]).toMatchObject({
        name: { contains: 'acme', mode: 'insensitive' },
      });
    });
  });

  describe('findOrganizationDetail', () => {
    it('computes occupancy percentage from bed/occupied counts', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Acme PG',
        status: 'ACTIVE',
        createdAt: new Date(),
        memberships: [
          {
            user: { id: 'owner-1', name: 'Owner', email: 'owner@example.com' },
          },
        ],
        subscription: {
          status: 'ACTIVE',
          currentPeriodEnd: new Date(),
          nextBillingAt: new Date(),
          gracePeriodEndsAt: null,
          saasPlan: { name: 'Basic' },
        },
        _count: { properties: 1 },
      });
      prisma.room.count.mockResolvedValue(4);
      prisma.bed.count.mockResolvedValueOnce(8).mockResolvedValueOnce(4); // total, occupied
      prisma.residency.findMany.mockResolvedValue([
        { tenantId: 't1' },
        { tenantId: 't2' },
      ]);

      const result = await service.findOrganizationDetail('org-1');

      expect(result.bedCount).toBe(8);
      expect(result.occupiedBedCount).toBe(4);
      expect(result.occupancyPercentage).toBe(50);
      expect(result.tenantCount).toBe(2);
      expect(result.owner).toMatchObject({ userId: 'owner-1' });
    });

    it('throws ORGANIZATION_NOT_FOUND for an unknown organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.findOrganizationDetail('nope'),
      ).rejects.toMatchObject({
        code: ErrorCode.ORGANIZATION_NOT_FOUND,
      });
    });
  });

  describe('suspendOrganization / activateOrganization', () => {
    it('suspends an active organization via an atomic conditional update and records an audit entry', async () => {
      prisma.organization.updateMany.mockResolvedValue({ count: 1 });

      await service.suspendOrganization(buildAdmin(), 'org-1');

      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', status: { not: 'SUSPENDED' } },
        data: { status: 'SUSPENDED' },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANIZATION_SUSPENDED',
          entityId: 'org-1',
        }),
      );
    });

    it('rejects suspending an already-suspended organization (updateMany matches zero rows)', async () => {
      prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'SUSPENDED',
      });

      await expect(
        service.suspendOrganization(buildAdmin(), 'org-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ORGANIZATION_ALREADY_SUSPENDED,
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('throws ORGANIZATION_NOT_FOUND when updateMany matches zero rows because the org does not exist', async () => {
      prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.suspendOrganization(buildAdmin(), 'nope'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
    });

    it('activates a suspended organization via an atomic conditional update and records an audit entry', async () => {
      prisma.organization.updateMany.mockResolvedValue({ count: 1 });

      await service.activateOrganization(buildAdmin(), 'org-1');

      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-1', status: { not: 'ACTIVE' } },
        data: { status: 'ACTIVE' },
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORGANIZATION_ACTIVATED' }),
      );
    });

    it('rejects activating an already-active organization (updateMany matches zero rows)', async () => {
      prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'ACTIVE',
      });

      await expect(
        service.activateOrganization(buildAdmin(), 'org-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_ALREADY_ACTIVE });
    });

    it('under concurrency, exactly one of two simultaneous suspend calls succeeds', async () => {
      // Simulate the database-level atomicity updateMany provides: the
      // first call to reach the (mocked) DB wins the conditional update,
      // the second matches zero rows - proven for real against actual
      // Postgres in scripts/verify-platform-admin.ts (Test 5).
      let alreadySuspended = false;
      prisma.organization.updateMany.mockImplementation(async () => {
        if (alreadySuspended) return { count: 0 };
        alreadySuspended = true;
        return { count: 1 };
      });
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        status: 'SUSPENDED',
      });

      const results = await Promise.allSettled([
        service.suspendOrganization(buildAdmin(), 'org-1'),
        service.suspendOrganization(buildAdmin(), 'org-1'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      expect(fulfilled).toBe(1);
      expect(rejected).toBe(1);
    });
  });

  describe('findOwners / findOwnerDetail', () => {
    it('scopes owners to users with an ACTIVE OWNER membership', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.findOwners({ page: 1, limit: 20 });

      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.memberships).toEqual({
        some: { role: 'OWNER', status: 'ACTIVE' },
      });
    });

    it('throws OWNER_NOT_FOUND for a user with no OWNER membership', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOwnerDetail('user-x')).rejects.toMatchObject({
        code: ErrorCode.OWNER_NOT_FOUND,
      });
    });
  });

  describe('findProperties', () => {
    it('aggregates bed counts per property without loading unrelated rows', async () => {
      prisma.property.findMany.mockResolvedValue([
        {
          id: 'p1',
          organizationId: 'org-1',
          organization: { name: 'Acme' },
          name: 'PG1',
          propertyType: 'PG',
          city: 'Hyderabad',
          state: 'TG',
          status: 'ACTIVE',
          createdAt: new Date(),
          _count: { rooms: 3 },
        },
      ]);
      prisma.property.count.mockResolvedValue(1);
      prisma.bed.count.mockResolvedValue(6);

      const result = await service.findProperties({ page: 1, limit: 20 });

      expect(result.items[0]).toMatchObject({
        roomCount: 3,
        bedCount: 6,
        organizationName: 'Acme',
      });
    });
  });

  describe('findSubscriptionDetail', () => {
    it('reports outstanding invoice total and last payment status', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        organization: { name: 'Acme' },
        saasPlan: { name: 'Basic', price: new Prisma.Decimal('499.00') },
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        nextBillingAt: new Date(),
        gracePeriodEndsAt: null,
      });
      prisma.subscriptionPayment.findFirst.mockResolvedValue({
        status: 'CAPTURED',
      });
      prisma.subscriptionInvoice.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal('499.00') },
      });

      const result = await service.findSubscriptionDetail('sub-1');

      expect(result.lastPaymentStatus).toBe('CAPTURED');
      expect(result.outstandingInvoiceTotal).toBe('499');
    });

    it('throws SUBSCRIPTION_NOT_FOUND for an unknown subscription', async () => {
      prisma.organizationSubscription.findUnique.mockResolvedValue(null);
      await expect(
        service.findSubscriptionDetail('nope'),
      ).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_NOT_FOUND,
      });
    });
  });
});
