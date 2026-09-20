import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MembershipRole, Room } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';

// Same role split as PropertiesService: MANAGER handles day-to-day
// inventory setup, archiving is OWNER-only (bigger blast radius - it
// implicitly retires every bed under the room).
const CREATE_UPDATE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

// Room has no organizationId column of its own (only Property does) - this
// carries it alongside the row whenever a caller needs both, without a
// second round-trip to the database.
type RoomWithOrganization = Room & { organizationId: string };

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
  ) {}

  // Reuses PropertiesService's own org-scoped lookup rather than
  // re-deriving "is this property accessible" - the authorization chain is
  // User -> OrganizationMembership -> Organization -> Property, and this is
  // the one place Rooms enters that chain.
  async create(
    user: AuthenticatedUser,
    propertyId: string,
    dto: CreateRoomDto,
  ): Promise<RoomResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertRoleForProperty(
      user,
      property.organizationId,
      CREATE_UPDATE_ROLES,
    );

    if (property.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_ACTIVE,
        'Cannot add a room to a property that is not active.',
        HttpStatus.CONFLICT,
      );
    }

    // A duplicate (propertyId, roomNumber) raises Prisma's P2002, already
    // turned into 409 CONFLICT by AllExceptionsFilter - same pattern Phase
    // 1/2 rely on for duplicate email/phone/membership. No separate
    // DUPLICATE_ROOM_NUMBER code needed.
    const room = await this.prisma.room.create({
      data: {
        propertyId,
        roomNumber: dto.roomNumber,
        floor: dto.floor,
        roomType: dto.roomType,
        capacity: dto.capacity,
      },
    });

    this.logger.log(
      `ROOM_CREATED room=${room.id} property=${propertyId} by=${user.id}`,
    );
    return RoomResponseDto.fromEntity(room);
  }

  async findAccessible(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<RoomResponseDto[]> {
    // Confirms the property itself is accessible even if it has zero
    // rooms - an inaccessible propertyId must 404 here too, not return an
    // empty list (which would be a second, inconsistent way of saying the
    // same thing - see PropertiesService.findAccessible for the same
    // reasoning applied to organizationId).
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);

    const rooms = await this.prisma.room.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
    return rooms.map(RoomResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
  ): Promise<RoomResponseDto> {
    const room = await this.getAccessibleRoomOrThrow(user, propertyId, roomId);
    return RoomResponseDto.fromEntity(room);
  }

  async update(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ): Promise<RoomResponseDto> {
    const room = await this.getAccessibleRoomOrThrow(user, propertyId, roomId);
    await this.assertRoleForProperty(
      user,
      room.organizationId,
      CREATE_UPDATE_ROLES,
    );

    if (dto.capacity === undefined || dto.capacity >= room.capacity) {
      const updated = await this.prisma.room.update({
        where: { id: roomId },
        data: dto,
      });
      return RoomResponseDto.fromEntity(updated);
    }

    // Reducing capacity: must not drop below the room's current
    // non-archived bed count. `SELECT ... FOR UPDATE` locks this room row
    // for the duration of the transaction so a concurrent bed creation
    // (which takes the same lock - see BedsService.create) cannot slip a
    // new bed in between this count and the update; one of the two
    // transactions always waits for the other's lock to release before it
    // can even read a consistent count.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
      const activeBedCount = await tx.bed.count({
        where: { roomId, status: { not: 'ARCHIVED' } },
      });
      if (dto.capacity! < activeBedCount) {
        throw new AppException(
          ErrorCode.ROOM_CAPACITY_BELOW_BED_COUNT,
          `Cannot reduce capacity below the current number of beds (${activeBedCount}).`,
          HttpStatus.CONFLICT,
        );
      }
      const updated = await tx.room.update({
        where: { id: roomId },
        data: dto,
      });
      return RoomResponseDto.fromEntity(updated);
    });
  }

  // OWNER-only, soft archive - see spec section 13. A room accumulates
  // beds (and, from Phase 4, allocation history) underneath it; archiving
  // never hard-deletes.
  async archive(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
  ): Promise<RoomResponseDto> {
    const room = await this.getAccessibleRoomOrThrow(user, propertyId, roomId);
    await this.assertRoleForProperty(user, room.organizationId, ['OWNER']);

    const archived = await this.prisma.room.update({
      where: { id: roomId },
      data: { status: 'ARCHIVED' },
    });
    this.logger.log(`ROOM_ARCHIVED room=${roomId} by=${user.id}`);
    return RoomResponseDto.fromEntity(archived);
  }

  // The BOLA/IDOR defense for the Room level of the chain, and the seam
  // BedsService reuses for the level below it. A single query requires
  // room.id, room.propertyId (rejects a room id borrowed from a different
  // property's URL - spec section 8's "reject mismatched resource
  // relationships"), AND organization membership - never "load the room by
  // id, then separately check its property/org afterward".
  async getAccessibleRoomOrThrow(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
  ): Promise<RoomWithOrganization> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const accessibleOrgIds = isSuperAdmin
      ? undefined
      : await this.memberships.listActiveOrganizationIds(user.id);

    const room = await this.prisma.room.findFirst({
      where: {
        id: roomId,
        propertyId,
        property: isSuperAdmin
          ? undefined
          : { organizationId: { in: accessibleOrgIds } },
      },
      include: { property: { select: { organizationId: true } } },
    });
    if (!room) {
      throw new AppException(
        ErrorCode.ROOM_NOT_FOUND,
        'Room not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const { property, ...roomFields } = room;
    return { ...roomFields, organizationId: property.organizationId };
  }

  private async assertRoleForProperty(
    user: AuthenticatedUser,
    organizationId: string,
    allowedRoles: MembershipRole[],
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    // getAccessiblePropertyOrThrow/getAccessibleRoomOrThrow already proved
    // an active membership exists for this organizationId, so this cannot
    // be null in practice - re-fetched to keep role-checking centralized
    // in one place (MembershipsService), exactly like PropertiesService.
    const membership = await this.memberships.getActiveMembership(
      user.id,
      organizationId,
    );
    this.memberships.assertRole(user, membership, allowedRoles);
  }
}
