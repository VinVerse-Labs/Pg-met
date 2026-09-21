import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { TenantsService } from '../tenants/tenants.service';
import { FoodSubscriptionsService } from '../food/services/food-subscriptions.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { ResidenciesService } from './residencies.service';

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

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

const accessibleProperty = {
  id: 'prop-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
};

describe('ResidenciesService', () => {
  let service: ResidenciesService;
  let prisma: {
    residency: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    bed: { findFirst: jest.Mock };
    bedAllocation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let tenants: { assertExists: jest.Mock };
  let foodSubscriptions: { cancelForCheckout: jest.Mock };
  let eventBus: { emit: jest.Mock };

  const createDto = {
    tenantId: 'tenant-1',
    startDate: '2027-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    prisma = {
      residency: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bed: { findFirst: jest.fn() },
      bedAllocation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    memberships = {
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    tenants = { assertExists: jest.fn() };
    foodSubscriptions = {
      cancelForCheckout: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new ResidenciesService(
      prisma as any,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
      tenants as unknown as TenantsService,
      foodSubscriptions as unknown as FoodSubscriptionsService,
      eventBus as unknown as DomainEventBusService,
    );

    properties.getAccessiblePropertyOrThrow.mockResolvedValue(
      accessibleProperty,
    );
    tenants.assertExists.mockResolvedValue({
      id: 'tenant-1',
      userId: 'user-2',
    });
    prisma.residency.findFirst.mockResolvedValue(null);
  });

  describe('create', () => {
    it('creates a residency in PENDING status', async () => {
      prisma.residency.create.mockResolvedValue({
        id: 'res-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-1',
        startDate: new Date(createDto.startDate),
        expectedEndDate: null,
        actualEndDate: null,
        status: 'PENDING',
        createdAt: new Date(),
      });

      const result = await service.create(
        buildUser(),
        'prop-1',
        createDto as any,
      );

      expect(result.status).toBe('PENDING');
      expect(prisma.residency.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            propertyId: 'prop-1',
          }),
        }),
      );
    });

    it('rejects an inaccessible/spoofed property', async () => {
      properties.getAccessiblePropertyOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.PROPERTY_NOT_FOUND,
        }),
      );

      await expect(
        service.create(buildUser(), 'prop-in-other-org', createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_FOUND });
      expect(prisma.residency.create).not.toHaveBeenCalled();
    });

    it('rejects creating a residency at a non-active property', async () => {
      properties.getAccessiblePropertyOrThrow.mockResolvedValue({
        ...accessibleProperty,
        status: 'ARCHIVED',
      });

      await expect(
        service.create(buildUser(), 'prop-1', createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_ACTIVE });
      expect(prisma.residency.create).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent tenant', async () => {
      tenants.assertExists.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.TENANT_NOT_FOUND,
        }),
      );

      await expect(
        service.create(buildUser(), 'prop-1', createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_NOT_FOUND });
    });

    it('rejects an invalid date range (expectedEndDate before startDate)', async () => {
      await expect(
        service.create(buildUser(), 'prop-1', {
          ...createDto,
          expectedEndDate: '2026-12-01T00:00:00.000Z',
        } as any),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(prisma.residency.create).not.toHaveBeenCalled();
    });

    it('rejects creating a second non-terminal residency for the same tenant', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-existing',
        status: 'ACTIVE',
      });

      await expect(
        service.create(buildUser(), 'prop-1', createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.TENANT_ALREADY_ALLOCATED });
      expect(prisma.residency.create).not.toHaveBeenCalled();
    });

    it('rejects a STAFF member trying to create a residency', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.create(buildUser(), 'prop-1', createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.residency.create).not.toHaveBeenCalled();
    });
  });

  describe('getAccessibleResidencyOrThrow (via findOne) / BOLA protection', () => {
    it('returns the residency when accessible', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        id: 'res-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-1',
        startDate: new Date(),
        expectedEndDate: null,
        actualEndDate: null,
        status: 'PENDING',
        createdAt: new Date(),
        property: { organizationId: 'org-1' },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      const result = await service.findOne(buildUser(), 'res-1');

      expect(result.id).toBe('res-1');
    });

    it('returns RESIDENCY_NOT_FOUND for a residency in another organization (IDOR)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.residency.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'res-in-org-99'),
      ).rejects.toMatchObject({ code: ErrorCode.RESIDENCY_NOT_FOUND });
    });
  });

  describe('update', () => {
    const existingResidency = {
      id: 'res-1',
      tenantId: 'tenant-1',
      propertyId: 'prop-1',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      expectedEndDate: null,
      actualEndDate: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      property: { organizationId: 'org-1' },
    };

    it('updates expectedEndDate', async () => {
      prisma.residency.findFirst.mockResolvedValue(existingResidency);
      prisma.residency.update.mockResolvedValue({
        ...existingResidency,
        expectedEndDate: new Date('2027-06-01T00:00:00.000Z'),
      });

      const result = await service.update(buildUser(), 'res-1', {
        expectedEndDate: '2027-06-01T00:00:00.000Z',
      });

      expect(result.expectedEndDate).toEqual(
        new Date('2027-06-01T00:00:00.000Z'),
      );
    });

    it('rejects an expectedEndDate before startDate', async () => {
      prisma.residency.findFirst.mockResolvedValue(existingResidency);

      await expect(
        service.update(buildUser(), 'res-1', {
          expectedEndDate: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(prisma.residency.update).not.toHaveBeenCalled();
    });
  });

  describe('checkIn', () => {
    const pendingResidency = {
      id: 'res-1',
      tenantId: 'tenant-1',
      propertyId: 'prop-1',
      startDate: new Date(),
      expectedEndDate: null,
      actualEndDate: null,
      status: 'PENDING',
      createdAt: new Date(),
      property: { organizationId: 'org-1' },
    };
    const activeBed = {
      id: 'bed-1',
      roomId: 'room-1',
      bedNumber: 'B1',
      status: 'AVAILABLE',
      room: {
        id: 'room-1',
        propertyId: 'prop-1',
        status: 'ACTIVE',
        property: { id: 'prop-1', status: 'ACTIVE' },
      },
    };

    beforeEach(() => {
      prisma.residency.findFirst.mockResolvedValue(pendingResidency);
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
    });

    it('checks in successfully: creates an allocation and activates the residency', async () => {
      prisma.bed.findFirst.mockResolvedValue(activeBed);
      prisma.bedAllocation.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          bedAllocation: {
            create: jest.fn().mockResolvedValue({
              id: 'alloc-1',
              residencyId: 'res-1',
              bedId: 'bed-1',
              startDate: new Date(),
              endDate: null,
              status: 'ACTIVE',
              createdAt: new Date(),
            }),
          },
          residency: {
            update: jest
              .fn()
              .mockResolvedValue({ ...pendingResidency, status: 'ACTIVE' }),
          },
        }),
      );

      const result = await service.checkIn(buildUser(), 'res-1', {
        bedId: 'bed-1',
      });

      expect(result.residency.status).toBe('ACTIVE');
      expect(result.allocation.status).toBe('ACTIVE');
    });

    it('rejects check-in when the residency is not PENDING', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        ...pendingResidency,
        status: 'ACTIVE',
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_RESIDENCY_STATE });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a bed that does not belong to the residency's property (mismatched chain / cross-org)", async () => {
      prisma.bed.findFirst.mockResolvedValue(null);

      await expect(
        service.checkIn(buildUser(), 'res-1', {
          bedId: 'bed-in-other-property',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.BED_NOT_FOUND });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an archived bed', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        ...activeBed,
        status: 'ARCHIVED',
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.BED_NOT_ACTIVE });
    });

    it('rejects an inactive bed', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        ...activeBed,
        status: 'INACTIVE',
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.BED_NOT_ACTIVE });
    });

    it('rejects a room that is not active', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        ...activeBed,
        room: { ...activeBed.room, status: 'ARCHIVED' },
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_ACTIVE });
    });

    it('rejects a property that is not active', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        ...activeBed,
        room: {
          ...activeBed.room,
          property: { id: 'prop-1', status: 'INACTIVE' },
        },
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_ACTIVE });
    });

    it('rejects a bed that already has an active allocation', async () => {
      prisma.bed.findFirst.mockResolvedValue(activeBed);
      prisma.bedAllocation.findFirst.mockResolvedValue({
        id: 'alloc-existing',
        status: 'ACTIVE',
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.BED_ALREADY_OCCUPIED });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a STAFF member trying to check in', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });

    describe('concurrency: the DB partial unique index is the real guard', () => {
      it('translates a bed_allocations_active_bed_unique violation into BED_ALREADY_OCCUPIED', async () => {
        prisma.bed.findFirst.mockResolvedValue(activeBed);
        prisma.bedAllocation.findFirst.mockResolvedValue(null); // pre-check race: passes
        prisma.$transaction.mockRejectedValue(
          p2002('bed_allocations_active_bed_unique'),
        );

        await expect(
          service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
        ).rejects.toMatchObject({ code: ErrorCode.BED_ALREADY_OCCUPIED });
      });

      it('translates a residencies_active_tenant_unique violation into TENANT_ALREADY_ALLOCATED', async () => {
        prisma.bed.findFirst.mockResolvedValue(activeBed);
        prisma.bedAllocation.findFirst.mockResolvedValue(null);
        prisma.$transaction.mockRejectedValue(
          p2002('residencies_active_tenant_unique'),
        );

        await expect(
          service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
        ).rejects.toMatchObject({ code: ErrorCode.TENANT_ALREADY_ALLOCATED });
      });

      it('never leaks a raw unrecognised database error', async () => {
        prisma.bed.findFirst.mockResolvedValue(activeBed);
        prisma.bedAllocation.findFirst.mockResolvedValue(null);
        const dbError = new Error('connection reset');
        prisma.$transaction.mockRejectedValue(dbError);

        await expect(
          service.checkIn(buildUser(), 'res-1', { bedId: 'bed-1' }),
        ).rejects.toBe(dbError);
      });
    });
  });

  describe('checkOut', () => {
    const activeResidency = {
      id: 'res-1',
      tenantId: 'tenant-1',
      propertyId: 'prop-1',
      startDate: new Date(),
      expectedEndDate: null,
      actualEndDate: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      property: { organizationId: 'org-1' },
    };

    beforeEach(() => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
    });

    it('checks out successfully: ends the allocation and marks the residency CHECKED_OUT', async () => {
      prisma.residency.findFirst.mockResolvedValue(activeResidency);
      prisma.bedAllocation.findFirst.mockResolvedValue({
        id: 'alloc-1',
        status: 'ACTIVE',
      });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          bedAllocation: {
            update: jest.fn().mockResolvedValue({
              id: 'alloc-1',
              residencyId: 'res-1',
              bedId: 'bed-1',
              startDate: new Date(),
              endDate: new Date(),
              status: 'ENDED',
              createdAt: new Date(),
            }),
          },
          residency: {
            update: jest.fn().mockResolvedValue({
              ...activeResidency,
              status: 'CHECKED_OUT',
              actualEndDate: new Date(),
            }),
          },
        }),
      );

      const result = await service.checkOut(buildUser(), 'res-1');

      expect(result.residency.status).toBe('CHECKED_OUT');
      expect(result.allocation.status).toBe('ENDED');
    });

    it('rejects checking out a PENDING residency (never checked in)', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        ...activeResidency,
        status: 'PENDING',
      });

      await expect(
        service.checkOut(buildUser(), 'res-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CHECKOUT,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a double checkout (already CHECKED_OUT)', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        ...activeResidency,
        status: 'CHECKED_OUT',
      });

      await expect(
        service.checkOut(buildUser(), 'res-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CHECKOUT,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows checkout from NOTICE_PERIOD', async () => {
      prisma.residency.findFirst.mockResolvedValue({
        ...activeResidency,
        status: 'NOTICE_PERIOD',
      });
      prisma.bedAllocation.findFirst.mockResolvedValue({
        id: 'alloc-1',
        status: 'ACTIVE',
      });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          bedAllocation: {
            update: jest.fn().mockResolvedValue({
              id: 'alloc-1',
              residencyId: 'res-1',
              bedId: 'bed-1',
              startDate: new Date(),
              endDate: new Date(),
              status: 'ENDED',
              createdAt: new Date(),
            }),
          },
          residency: {
            update: jest
              .fn()
              .mockResolvedValue({ ...activeResidency, status: 'CHECKED_OUT' }),
          },
        }),
      );

      await expect(
        service.checkOut(buildUser(), 'res-1'),
      ).resolves.toBeDefined();
    });

    it('rejects a STAFF member trying to check out', async () => {
      prisma.residency.findFirst.mockResolvedValue(activeResidency);
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.checkOut(buildUser(), 'res-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INSUFFICIENT_ROLE,
      });
    });
  });
});
