import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Bed, MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { RoomsService } from '../rooms/rooms.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateBedDto } from './dto/create-bed.dto';
import { UpdateBedDto } from './dto/update-bed.dto';
import { BedOccupantDto, BedResponseDto } from './dto/bed-response.dto';

const CREATE_UPDATE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

// The bottom of the Phase 2/3 ownership chain: User -> OrganizationMembership
// -> Organization -> Property -> Room -> Bed. Every method re-derives access
// by walking down from PropertiesService/RoomsService's own verified
// lookups rather than trusting any id in the URL/body in isolation - this
// is what makes "room from property A used with property B in the URL", or
// "bed from room A used with room B", 404 instead of silently working.
@Injectable()
export class BedsService {
  private readonly logger = new Logger(BedsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly rooms: RoomsService,
  ) {}

  async create(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    dto: CreateBedDto,
  ): Promise<BedResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    if (property.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_ACTIVE,
        'Cannot add a bed to a room in a property that is not active.',
        HttpStatus.CONFLICT,
      );
    }

    const room = await this.rooms.getAccessibleRoomOrThrow(
      user,
      propertyId,
      roomId,
    );
    if (room.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.ROOM_NOT_ACTIVE,
        'Cannot add a bed to a room that is not active.',
        HttpStatus.CONFLICT,
      );
    }

    await this.assertRole(user, room.organizationId, CREATE_UPDATE_ROLES);

    // Capacity is enforced with a locked read-then-write, not a plain
    // "count then insert" - `SELECT ... FOR UPDATE` takes a row lock on
    // the room for the duration of this transaction, so a second,
    // concurrent bed-creation request for the SAME room blocks until this
    // one commits (or rolls back), and then re-reads an up-to-date count.
    // Two requests for two *different* rooms take different locks and
    // proceed fully in parallel. The (roomId, bedNumber) unique
    // constraint separately guarantees duplicate bed numbers can never
    // both succeed, even without this lock.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
      const activeBedCount = await tx.bed.count({
        where: { roomId, status: { not: 'ARCHIVED' } },
      });
      if (activeBedCount >= room.capacity) {
        throw new AppException(
          ErrorCode.ROOM_CAPACITY_EXCEEDED,
          `This room is at capacity (${room.capacity} beds).`,
          HttpStatus.CONFLICT,
        );
      }

      const bed = await tx.bed.create({
        data: { roomId, bedNumber: dto.bedNumber, berth: dto.berth },
      });
      this.logger.log(`BED_CREATED bed=${bed.id} room=${roomId} by=${user.id}`);
      return BedResponseDto.fromEntity(bed);
    });
  }

  async findAccessible(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
  ): Promise<BedResponseDto[]> {
    // Confirms the room itself is accessible even if it has zero beds.
    await this.rooms.getAccessibleRoomOrThrow(user, propertyId, roomId);

    const beds = await this.prisma.bed.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });
    const occupants = await this.occupantsByBed(beds.map((b) => b.id));
    return beds.map((bed) =>
      BedResponseDto.fromEntity(bed, occupants.get(bed.id) ?? null),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    bedId: string,
  ): Promise<BedResponseDto> {
    const { bed } = await this.getAccessibleBedWithOrg(
      user,
      propertyId,
      roomId,
      bedId,
    );
    const occupants = await this.occupantsByBed([bed.id]);
    return BedResponseDto.fromEntity(bed, occupants.get(bed.id) ?? null);
  }

  async update(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    bedId: string,
    dto: UpdateBedDto,
  ): Promise<BedResponseDto> {
    const { bed, organizationId } = await this.getAccessibleBedWithOrg(
      user,
      propertyId,
      roomId,
      bedId,
    );
    await this.assertRole(user, organizationId, CREATE_UPDATE_ROLES);

    const updated = await this.prisma.bed.update({
      where: { id: bed.id },
      data: dto,
    });
    const occupants = await this.occupantsByBed([updated.id]);
    return BedResponseDto.fromEntity(
      updated,
      occupants.get(updated.id) ?? null,
    );
  }

  // OWNER-only soft archive - identical convention to Property/Room.
  async archive(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    bedId: string,
  ): Promise<BedResponseDto> {
    const { bed, organizationId } = await this.getAccessibleBedWithOrg(
      user,
      propertyId,
      roomId,
      bedId,
    );
    await this.assertRole(user, organizationId, ['OWNER']);

    const archived = await this.prisma.bed.update({
      where: { id: bed.id },
      data: { status: 'ARCHIVED' },
    });
    this.logger.log(`BED_ARCHIVED bed=${bedId} by=${user.id}`);
    return BedResponseDto.fromEntity(archived);
  }

  // BOLA/IDOR defense at the Bed level: `roomId` here is the room already
  // proven (by RoomsService.getAccessibleRoomOrThrow) to belong to
  // `propertyId` and to an organization the caller can access - so
  // filtering the bed by `{ id: bedId, roomId }` is exactly as safe as a
  // single mega-query joining all the way up to organizationId would be: a
  // bed whose real roomId differs (borrowed from another room's URL) can
  // never match, and there is no window where a bed is read before its
  // room's authorization is checked.
  private async getAccessibleBedWithOrg(
    user: AuthenticatedUser,
    propertyId: string,
    roomId: string,
    bedId: string,
  ): Promise<{ bed: Bed; organizationId: string }> {
    const room = await this.rooms.getAccessibleRoomOrThrow(
      user,
      propertyId,
      roomId,
    );
    const bed = await this.prisma.bed.findFirst({
      where: { id: bedId, roomId },
    });
    if (!bed) {
      throw new AppException(
        ErrorCode.BED_NOT_FOUND,
        'Bed not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { bed, organizationId: room.organizationId };
  }

  private async assertRole(
    user: AuthenticatedUser,
    organizationId: string,
    allowedRoles: MembershipRole[],
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      organizationId,
    );
    this.memberships.assertRole(user, membership, allowedRoles);
  }

  // Phase 13: one query for any number of beds - ACTIVE allocations with
  // the tenant's name/phone and their current ACTIVE rent plan.
  private async occupantsByBed(
    bedIds: string[],
  ): Promise<Map<string, BedOccupantDto>> {
    const result = new Map<string, BedOccupantDto>();
    if (bedIds.length === 0) return result;
    const allocations = await this.prisma.bedAllocation.findMany({
      where: { status: 'ACTIVE', bedId: { in: bedIds } },
      include: {
        residency: {
          select: {
            id: true,
            tenantId: true,
            tenant: {
              select: { user: { select: { name: true, phone: true } } },
            },
            rentPlans: {
              where: { status: 'ACTIVE' },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
              select: { amount: true, currency: true },
            },
          },
        },
      },
    });
    for (const allocation of allocations) {
      const residency = allocation.residency;
      const plan = residency.rentPlans[0];
      result.set(allocation.bedId, {
        residencyId: residency.id,
        tenantId: residency.tenantId,
        name: residency.tenant.user.name,
        phone: residency.tenant.user.phone ?? null,
        since: allocation.startDate,
        monthlyRent: plan ? new Prisma.Decimal(plan.amount).toFixed(2) : null,
        currency: plan?.currency ?? null,
      });
    }
    return result;
  }
}
