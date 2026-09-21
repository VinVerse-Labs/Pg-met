import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MembershipRole, Prisma, Residency } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { TenantsService } from '../tenants/tenants.service';
import { FoodSubscriptionsService } from '../food/services/food-subscriptions.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateResidencyDto } from './dto/create-residency.dto';
import { UpdateResidencyDto } from './dto/update-residency.dto';
import { CheckInDto } from './dto/check-in.dto';
import { ResidencyResponseDto } from './dto/residency-response.dto';
import { ResidencyActionResponseDto } from './dto/residency-action-response.dto';
import { BedAllocationResponseDto } from './dto/bed-allocation-response.dto';

// Same role split as Property/Room/Bed: MANAGER handles the day-to-day
// operational workflow (creating residencies, checking people in/out),
// STAFF is read-only. Check-in/check-out are treated as ordinary
// operational actions here, not "archiving" - unlike Property/Room/Bed's
// OWNER-only delete, a manager routinely checking a resident in or out is
// normal day-to-day work, not a structural decision about the business.
const CREATE_UPDATE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

// Residency has no organizationId column of its own (only Property does) -
// carried alongside the row so callers needing both don't re-fetch it,
// the same pattern RoomsService uses for Room.
export type ResidencyWithOrganization = Residency & { organizationId: string };

const NON_TERMINAL_STATUSES = ['PENDING', 'ACTIVE', 'NOTICE_PERIOD'] as const;

@Injectable()
export class ResidenciesService {
  private readonly logger = new Logger(ResidenciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly tenants: TenantsService,
    private readonly foodSubscriptions: FoodSubscriptionsService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // Creates a residency in PENDING - no bed is allocated here (see spec
  // section 19: check-in is a deliberately separate, explicit action).
  async create(
    user: AuthenticatedUser,
    propertyId: string,
    dto: CreateResidencyDto,
  ): Promise<ResidencyResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertRole(user, property.organizationId, CREATE_UPDATE_ROLES);

    if (property.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_ACTIVE,
        'Cannot create a residency at a property that is not active.',
        HttpStatus.CONFLICT,
      );
    }

    await this.tenants.assertExists(dto.tenantId);

    const startDate = new Date(dto.startDate);
    const expectedEndDate = dto.expectedEndDate
      ? new Date(dto.expectedEndDate)
      : null;
    if (expectedEndDate && expectedEndDate < startDate) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'expectedEndDate cannot be before startDate.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Application-level pre-check for a friendly error message. The
    // database partial unique index (residencies_active_tenant_unique) is
    // what actually guarantees this under concurrent requests - this
    // check alone would have the same race window described in spec
    // section 10 if it were the only guard (see checkIn() below for where
    // that index's violation is caught and translated).
    const existingNonTerminal = await this.prisma.residency.findFirst({
      where: {
        tenantId: dto.tenantId,
        status: { in: [...NON_TERMINAL_STATUSES] },
      },
    });
    if (existingNonTerminal) {
      throw new AppException(
        ErrorCode.TENANT_ALREADY_ALLOCATED,
        'This tenant already has an active or pending residency.',
        HttpStatus.CONFLICT,
      );
    }

    const residency = await this.prisma.residency.create({
      data: { tenantId: dto.tenantId, propertyId, startDate, expectedEndDate },
    });
    this.logger.log(
      `RESIDENCY_CREATED residency=${residency.id} property=${propertyId} tenant=${dto.tenantId} by=${user.id}`,
    );
    return ResidencyResponseDto.fromEntity(residency);
  }

  async findAccessibleForProperty(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<ResidencyResponseDto[]> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    const residencies = await this.prisma.residency.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
    return residencies.map(ResidencyResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    residencyId: string,
  ): Promise<ResidencyResponseDto> {
    const residency = await this.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    return ResidencyResponseDto.fromEntity(residency);
  }

  async update(
    user: AuthenticatedUser,
    residencyId: string,
    dto: UpdateResidencyDto,
  ): Promise<ResidencyResponseDto> {
    const residency = await this.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    await this.assertRole(user, residency.organizationId, CREATE_UPDATE_ROLES);

    const expectedEndDate = new Date(dto.expectedEndDate);
    if (expectedEndDate < residency.startDate) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'expectedEndDate cannot be before startDate.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.residency.update({
      where: { id: residencyId },
      data: { expectedEndDate },
    });
    return ResidencyResponseDto.fromEntity(updated);
  }

  // The full check-in flow from spec section 13: authenticate (guard) ->
  // membership (getAccessibleResidencyOrThrow) -> role (assertRole) ->
  // residency in a valid pre-check-in state -> bed belongs to the same
  // property -> property/room/bed all active -> no active allocation ->
  // atomic create-allocation + activate-residency.
  async checkIn(
    user: AuthenticatedUser,
    residencyId: string,
    dto: CheckInDto,
  ): Promise<ResidencyActionResponseDto> {
    const residency = await this.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    await this.assertRole(user, residency.organizationId, CREATE_UPDATE_ROLES);

    if (residency.status !== 'PENDING') {
      throw new AppException(
        ErrorCode.INVALID_RESIDENCY_STATE,
        'Residency must be PENDING to check in.',
        HttpStatus.CONFLICT,
      );
    }

    // The bed's room/property are read from the database relation, never
    // taken as separate client input - `dto` has no roomId/propertyId
    // field for a client to mismatch (spec section 14). Filtering by
    // `room: { propertyId: residency.propertyId }` is what rejects "Bed
    // from Property B" - a bed whose actual property differs simply never
    // matches, and is 404, not a distinguishable error.
    const bed = await this.prisma.bed.findFirst({
      where: { id: dto.bedId, room: { propertyId: residency.propertyId } },
      include: { room: { include: { property: true } } },
    });
    if (!bed) {
      throw new AppException(
        ErrorCode.BED_NOT_FOUND,
        'Bed not found in this property.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (bed.room.property.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_ACTIVE,
        'Property is not active.',
        HttpStatus.CONFLICT,
      );
    }
    if (bed.room.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.ROOM_NOT_ACTIVE,
        'Room is not active.',
        HttpStatus.CONFLICT,
      );
    }
    if (bed.status !== 'AVAILABLE') {
      throw new AppException(
        ErrorCode.BED_NOT_ACTIVE,
        'Bed is not active.',
        HttpStatus.CONFLICT,
      );
    }

    // Application-level pre-check, same reasoning as create()'s tenant
    // check above - the real concurrency guarantee is the
    // bed_allocations_active_bed_unique partial index caught below.
    const existingAllocation = await this.prisma.bedAllocation.findFirst({
      where: { bedId: dto.bedId, status: 'ACTIVE' },
    });
    if (existingAllocation) {
      throw new AppException(
        ErrorCode.BED_ALREADY_OCCUPIED,
        'This bed is already occupied.',
        HttpStatus.CONFLICT,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const allocation = await tx.bedAllocation.create({
          data: { residencyId, bedId: dto.bedId, startDate: new Date() },
        });
        const updatedResidency = await tx.residency.update({
          where: { id: residencyId },
          data: { status: 'ACTIVE' },
        });
        return { allocation, residency: updatedResidency };
      });

      this.logger.log(
        `RESIDENCY_CHECKED_IN residency=${residencyId} bed=${dto.bedId} by=${user.id}`,
      );
      // Fired after the transaction has already committed (spec section
      // 46) - a notification failure can never roll back or fail the
      // check-in itself (DomainEventBusService.emit never throws).
      await this.eventBus.emit(NotificationType.RESIDENCY_CHECKED_IN, {
        residencyId,
      });
      return {
        residency: ResidencyResponseDto.fromEntity(result.residency),
        allocation: BedAllocationResponseDto.fromEntity(result.allocation),
      };
    } catch (error) {
      // Two concurrent check-ins for the same bed (or the same tenant)
      // can both pass the pre-checks above and both reach this insert -
      // exactly one wins the partial unique index; the other's INSERT
      // raises P2002 here, which is translated into the same safe
      // domain-level conflict a caller would see from the pre-check,
      // rather than a raw database error (spec section 31).
      if (this.isUniqueViolation(error, 'bed_allocations_active_bed_unique')) {
        throw new AppException(
          ErrorCode.BED_ALREADY_OCCUPIED,
          'This bed has just been allocated to someone else.',
          HttpStatus.CONFLICT,
        );
      }
      if (this.isUniqueViolation(error, 'residencies_active_tenant_unique')) {
        throw new AppException(
          ErrorCode.TENANT_ALREADY_ALLOCATED,
          'This tenant already has an active residency.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async checkOut(
    user: AuthenticatedUser,
    residencyId: string,
  ): Promise<ResidencyActionResponseDto> {
    const residency = await this.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    await this.assertRole(user, residency.organizationId, CREATE_UPDATE_ROLES);

    if (residency.status !== 'ACTIVE' && residency.status !== 'NOTICE_PERIOD') {
      throw new AppException(
        ErrorCode.INVALID_CHECKOUT,
        'Residency is not active.',
        HttpStatus.CONFLICT,
      );
    }

    const activeAllocation = await this.prisma.bedAllocation.findFirst({
      where: { residencyId, status: 'ACTIVE' },
    });
    if (!activeAllocation) {
      // Should not happen if the ACTIVE/NOTICE_PERIOD invariant holds, but
      // fails safely rather than checking out with nothing to end.
      throw new AppException(
        ErrorCode.INVALID_CHECKOUT,
        'No active bed allocation found for this residency.',
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();
    // Never deletes the allocation - ending it (status + endDate) is what
    // preserves "who lived where, when" for future reads (spec section 15).
    const result = await this.prisma.$transaction(async (tx) => {
      const allocation = await tx.bedAllocation.update({
        where: { id: activeAllocation.id },
        data: { status: 'ENDED', endDate: now },
      });
      const updatedResidency = await tx.residency.update({
        where: { id: residencyId },
        data: { status: 'CHECKED_OUT', actualEndDate: now },
      });
      // Phase 10 (spec section 49): an active food subscription must not
      // outlive the residency it belongs to - ends it (EXPIRED) in the
      // same transaction as checkout, never as a separate best-effort
      // follow-up call. Historical invoices/payments are untouched (see
      // FoodSubscriptionsService.cancelForCheckout's own doc comment).
      await this.foodSubscriptions.cancelForCheckout(tx, residencyId);
      return { allocation, residency: updatedResidency };
    });

    this.logger.log(
      `RESIDENCY_CHECKED_OUT residency=${residencyId} by=${user.id}`,
    );
    await this.eventBus.emit(NotificationType.RESIDENCY_CHECKED_OUT, {
      residencyId,
    });
    return {
      residency: ResidencyResponseDto.fromEntity(result.residency),
      allocation: BedAllocationResponseDto.fromEntity(result.allocation),
    };
  }

  // BOLA/IDOR defense for Residency, one level below Property: a single
  // query requiring residency.id AND organization membership (via the
  // Property relation) - never "load by id, then check ownership after".
  // Public: RentPlansService/InvoicesService (Phase 5) reuse this exact
  // lookup rather than re-deriving organization access, the same reuse
  // chain PropertiesService -> RoomsService -> BedsService already
  // established.
  async getAccessibleResidencyOrThrow(
    user: AuthenticatedUser,
    residencyId: string,
  ): Promise<ResidencyWithOrganization> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const accessibleOrgIds = isSuperAdmin
      ? undefined
      : await this.memberships.listActiveOrganizationIds(user.id);

    const residency = await this.prisma.residency.findFirst({
      where: {
        id: residencyId,
        property: isSuperAdmin
          ? undefined
          : { organizationId: { in: accessibleOrgIds } },
      },
      include: { property: { select: { organizationId: true } } },
    });
    if (!residency) {
      throw new AppException(
        ErrorCode.RESIDENCY_NOT_FOUND,
        'Residency not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const { property, ...fields } = residency;
    return { ...fields, organizationId: property.organizationId };
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

  private isUniqueViolation(error: unknown, indexName: string): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target.includes(indexName);
    }
    if (Array.isArray(target)) {
      return target.includes(indexName);
    }
    return false;
  }
}
