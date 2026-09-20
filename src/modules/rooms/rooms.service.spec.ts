import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { RoomsService } from './rooms.service';

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

const createDto = {
  roomNumber: '101',
  roomType: 'DOUBLE' as const,
  capacity: 3,
};

describe('RoomsService', () => {
  let service: RoomsService;
  let prisma: {
    room: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
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

  beforeEach(() => {
    prisma = {
      room: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
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
    service = new RoomsService(
      prisma as any,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
    );
  });

  describe('create', () => {
    it('creates a room when the property is accessible, active, and the caller has an allowed role', async () => {
      properties.getAccessiblePropertyOrThrow.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
      });
      prisma.room.create.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        ...createDto,
        floor: null,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.create(buildUser(), 'prop-1', createDto);

      expect(memberships.assertRole).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        ['OWNER', 'MANAGER'],
      );
      expect(result.roomNumber).toBe('101');
    });

    it('rejects creating a room in a non-active property', async () => {
      properties.getAccessiblePropertyOrThrow.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.create(buildUser(), 'prop-1', createDto),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_ACTIVE });
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('propagates ORGANIZATION_NOT_FOUND for an inaccessible/spoofed property', async () => {
      properties.getAccessiblePropertyOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.ORGANIZATION_NOT_FOUND,
        }),
      );

      await expect(
        service.create(buildUser(), 'prop-in-other-org', createDto),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
      expect(prisma.room.create).not.toHaveBeenCalled();
    });

    it('rejects a STAFF member trying to create a room', async () => {
      properties.getAccessiblePropertyOrThrow.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
      });
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.create(buildUser(), 'prop-1', createDto),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.room.create).not.toHaveBeenCalled();
    });
  });

  describe('getAccessibleRoomOrThrow / BOLA protection', () => {
    it('returns the room when it belongs to the given property and an accessible organization', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        roomNumber: '101',
        capacity: 3,
        status: 'ACTIVE',
        property: { organizationId: 'org-1' },
      });

      const room = await service.getAccessibleRoomOrThrow(
        buildUser(),
        'prop-1',
        'room-1',
      );

      expect(room.organizationId).toBe('org-1');
      expect(prisma.room.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'room-1',
            propertyId: 'prop-1',
            property: { organizationId: { in: ['org-1'] } },
          },
        }),
      );
    });

    it('returns ROOM_NOT_FOUND when the room belongs to another organization (IDOR)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.room.findFirst.mockResolvedValue(null);

      await expect(
        service.getAccessibleRoomOrThrow(
          buildUser(),
          'prop-1',
          'room-in-org-99',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });

    it('returns ROOM_NOT_FOUND when the room belongs to a different property than the URL claims', async () => {
      // Even if the room IS in an accessible organization, findFirst's
      // `propertyId` filter means a room fetched via the wrong property's
      // URL never matches.
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.room.findFirst.mockResolvedValue(null);

      await expect(
        service.getAccessibleRoomOrThrow(
          buildUser(),
          'wrong-property',
          'room-1',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });
  });

  describe('update', () => {
    it('updates fields that do not touch capacity without locking', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        capacity: 3,
        property: { organizationId: 'org-1' },
      });
      prisma.room.update.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        roomNumber: '102',
        roomType: 'DOUBLE',
        capacity: 3,
        floor: null,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.update(buildUser(), 'prop-1', 'room-1', {
        roomNumber: '102',
      });

      expect(result.roomNumber).toBe('102');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows increasing capacity without a bed-count check', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        capacity: 3,
        property: { organizationId: 'org-1' },
      });
      prisma.room.update.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        capacity: 5,
        roomNumber: '101',
        roomType: 'DOUBLE',
        floor: null,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.update(buildUser(), 'prop-1', 'room-1', {
        capacity: 5,
      });

      expect(result.capacity).toBe(5);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects reducing capacity below the current non-archived bed count', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        capacity: 3,
        property: { organizationId: 'org-1' },
      });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
          bed: { count: jest.fn().mockResolvedValue(2) },
        }),
      );

      await expect(
        service.update(buildUser(), 'prop-1', 'room-1', { capacity: 1 }),
      ).rejects.toMatchObject({
        code: ErrorCode.ROOM_CAPACITY_BELOW_BED_COUNT,
      });
    });

    it('allows reducing capacity down to (but not below) the current bed count', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        capacity: 3,
        property: { organizationId: 'org-1' },
      });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'room-1' }]),
          bed: { count: jest.fn().mockResolvedValue(2) },
          room: {
            update: jest.fn().mockResolvedValue({
              id: 'room-1',
              propertyId: 'prop-1',
              capacity: 2,
              roomNumber: '101',
              roomType: 'DOUBLE',
              floor: null,
              status: 'ACTIVE',
              createdAt: new Date(),
            }),
          },
        }),
      );

      const result = await service.update(buildUser(), 'prop-1', 'room-1', {
        capacity: 2,
      });

      expect(result.capacity).toBe(2);
    });
  });

  describe('archive', () => {
    it('rejects a MANAGER trying to archive (OWNER only)', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        property: { organizationId: 'org-1' },
      });
      memberships.assertRole.mockImplementation((_user, _m, roles) => {
        if (!roles.includes('OWNER') || roles.length > 1) {
          throw Object.assign(new Error('forbidden'), {
            code: ErrorCode.INSUFFICIENT_ROLE,
          });
        }
      });

      // Simulate a MANAGER-only assertRole failure explicitly.
      memberships.assertRole.mockImplementationOnce(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.archive(buildUser(), 'prop-1', 'room-1'),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('allows an OWNER to archive the room', async () => {
      prisma.room.findFirst.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        property: { organizationId: 'org-1' },
      });
      prisma.room.update.mockResolvedValue({
        id: 'room-1',
        propertyId: 'prop-1',
        roomNumber: '101',
        roomType: 'DOUBLE',
        capacity: 3,
        floor: null,
        status: 'ARCHIVED',
        createdAt: new Date(),
      });

      const result = await service.archive(buildUser(), 'prop-1', 'room-1');

      expect(result.status).toBe('ARCHIVED');
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'ARCHIVED' },
      });
    });
  });
});
