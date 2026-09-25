import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { RoomsService } from '../rooms/rooms.service';
import { BedsService } from './beds.service';

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

const accessibleRoom = {
  id: 'room-1',
  propertyId: 'prop-1',
  capacity: 2,
  status: 'ACTIVE',
  organizationId: 'org-1',
};

describe('BedsService', () => {
  let service: BedsService;
  let prisma: {
    bed: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    bedAllocation: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let memberships: {
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let rooms: { getAccessibleRoomOrThrow: jest.Mock };

  beforeEach(() => {
    prisma = {
      bed: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      bedAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    memberships = { getActiveMembership: jest.fn(), assertRole: jest.fn() };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    rooms = { getAccessibleRoomOrThrow: jest.fn() };
    service = new BedsService(
      prisma as any,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
      rooms as unknown as RoomsService,
    );

    properties.getAccessiblePropertyOrThrow.mockResolvedValue({
      id: 'prop-1',
      status: 'ACTIVE',
    });
    rooms.getAccessibleRoomOrThrow.mockResolvedValue(accessibleRoom);
  });

  describe('create', () => {
    it('creates a bed when under capacity', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
          bed: {
            count: jest.fn().mockResolvedValue(1),
            create: jest.fn().mockResolvedValue({
              id: 'bed-1',
              roomId: 'room-1',
              bedNumber: 'B2',
              status: 'AVAILABLE',
              createdAt: new Date(),
            }),
          },
        }),
      );

      const result = await service.create(buildUser(), 'prop-1', 'room-1', {
        bedNumber: 'B2',
      });

      expect(result.bedNumber).toBe('B2');
    });

    it('rejects creating a bed once the room is at capacity', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
          bed: { count: jest.fn().mockResolvedValue(2), create: jest.fn() },
        }),
      );

      await expect(
        service.create(buildUser(), 'prop-1', 'room-1', { bedNumber: 'B3' }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_CAPACITY_EXCEEDED });
    });

    it('does not count archived beds toward capacity', async () => {
      // 2 total beds exist but only 1 is non-archived - capacity 2 still
      // has room for one more.
      let countedWhere: unknown;
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
          bed: {
            count: jest.fn().mockImplementation(({ where }) => {
              countedWhere = where;
              return Promise.resolve(1);
            }),
            create: jest.fn().mockResolvedValue({
              id: 'bed-2',
              roomId: 'room-1',
              bedNumber: 'B2',
              status: 'AVAILABLE',
              createdAt: new Date(),
            }),
          },
        }),
      );

      await service.create(buildUser(), 'prop-1', 'room-1', {
        bedNumber: 'B2',
      });

      expect(countedWhere).toEqual({
        roomId: 'room-1',
        status: { not: 'ARCHIVED' },
      });
    });

    it('rejects creating a bed in a non-active room', async () => {
      rooms.getAccessibleRoomOrThrow.mockResolvedValue({
        ...accessibleRoom,
        status: 'ARCHIVED',
      });

      await expect(
        service.create(buildUser(), 'prop-1', 'room-1', { bedNumber: 'B1' }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_ACTIVE });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects creating a bed in a room belonging to a non-active property', async () => {
      properties.getAccessiblePropertyOrThrow.mockResolvedValue({
        id: 'prop-1',
        status: 'INACTIVE',
      });

      await expect(
        service.create(buildUser(), 'prop-1', 'room-1', { bedNumber: 'B1' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_ACTIVE });
      expect(rooms.getAccessibleRoomOrThrow).not.toHaveBeenCalled();
    });

    it('rejects a STAFF member trying to create a bed', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.create(buildUser(), 'prop-1', 'room-1', { bedNumber: 'B1' }),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findOne / BOLA protection', () => {
    it('returns BED_NOT_FOUND when the bed belongs to a different room (mismatched chain)', async () => {
      prisma.bed.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'prop-1', 'room-1', 'bed-in-other-room'),
      ).rejects.toMatchObject({ code: ErrorCode.BED_NOT_FOUND });
    });

    it('propagates ROOM_NOT_FOUND when the room itself is inaccessible (IDOR at the room level)', async () => {
      rooms.getAccessibleRoomOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.ROOM_NOT_FOUND,
        }),
      );

      await expect(
        service.findOne(buildUser(), 'prop-1', 'room-in-other-org', 'bed-1'),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
      expect(prisma.bed.findFirst).not.toHaveBeenCalled();
    });

    it('returns the bed when the chain is valid', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: 'bed-1',
        roomId: 'room-1',
        bedNumber: 'B1',
        status: 'AVAILABLE',
        createdAt: new Date(),
      });

      const result = await service.findOne(
        buildUser(),
        'prop-1',
        'room-1',
        'bed-1',
      );

      expect(result.id).toBe('bed-1');
    });
  });

  describe('archive', () => {
    it('rejects a MANAGER trying to archive (OWNER only)', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: 'bed-1',
        roomId: 'room-1',
        bedNumber: 'B1',
        status: 'AVAILABLE',
      });
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.archive(buildUser(), 'prop-1', 'room-1', 'bed-1'),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.bed.update).not.toHaveBeenCalled();
    });

    it('allows an OWNER to archive the bed (soft delete)', async () => {
      prisma.bed.findFirst.mockResolvedValue({
        id: 'bed-1',
        roomId: 'room-1',
        bedNumber: 'B1',
        status: 'AVAILABLE',
      });
      prisma.bed.update.mockResolvedValue({
        id: 'bed-1',
        roomId: 'room-1',
        bedNumber: 'B1',
        status: 'ARCHIVED',
        createdAt: new Date(),
      });

      const result = await service.archive(
        buildUser(),
        'prop-1',
        'room-1',
        'bed-1',
      );

      expect(result.status).toBe('ARCHIVED');
      expect(prisma.bed.update).toHaveBeenCalledWith({
        where: { id: 'bed-1' },
        data: { status: 'ARCHIVED' },
      });
    });
  });

  describe('Phase 13: occupants', () => {
    it('attaches the current occupant (name, phone, rent) to occupied beds only, in one query', async () => {
      rooms.getAccessibleRoomOrThrow.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        organizationId: 'org-1',
      });
      prisma.bed.findMany.mockResolvedValue([
        {
          id: 'b1',
          roomId: 'room-1',
          bedNumber: 'L1',
          status: 'AVAILABLE',
          berth: 'LOWER',
          createdAt: new Date(),
        },
        {
          id: 'b2',
          roomId: 'room-1',
          bedNumber: 'U1',
          status: 'AVAILABLE',
          berth: 'UPPER',
          createdAt: new Date(),
        },
      ]);
      prisma.bedAllocation.findMany.mockResolvedValue([
        {
          bedId: 'b1',
          startDate: new Date('2026-08-01'),
          residency: {
            id: 'res-1',
            tenantId: 't1',
            tenant: { user: { name: 'Rohit S.', phone: '9876500000' } },
            rentPlans: [{ amount: '7000', currency: 'INR' }],
          },
        },
      ]);

      const [lower, upper] = await service.findAccessible(
        buildUser(),
        'prop-1',
        'room-1',
      );

      expect(prisma.bedAllocation.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.bedAllocation.findMany.mock.calls[0][0].where).toEqual({
        status: 'ACTIVE',
        bedId: { in: ['b1', 'b2'] },
      });
      expect(lower.berth).toBe('LOWER');
      expect(lower.occupant).toEqual({
        residencyId: 'res-1',
        tenantId: 't1',
        name: 'Rohit S.',
        phone: '9876500000',
        since: new Date('2026-08-01'),
        monthlyRent: '7000.00',
        currency: 'INR',
      });
      expect(upper.occupant).toBeNull();
    });
  });
});
