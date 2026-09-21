import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Complaint, Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../common/dto/pagination-query.dto';
import { ComplaintActivityService } from './complaint-activity.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ListComplaintsQueryDto } from './dto/list-complaints.query.dto';
import { ComplaintResponseDto } from './dto/complaint-response.dto';

// Complaint visibility has two structurally different kinds of
// legitimate viewer - the reporting tenant, and any active member of the
// owning organization - the same shape TenantsService.findOne (Phase 4)
// and PaymentsService (Phase 6) already established a pattern for:
// fetch the row by id alone, then branch on access, rather than trying
// to express both access paths in one WHERE clause.
export const ORG_COMPLAINT_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;

export type ComplaintWithTenant = Complaint & { tenant: { userId: string } };

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly activity: ComplaintActivityService,
  ) {}

  // The one and only complaint-creation path. Every identity field
  // (organizationId/propertyId/residencyId/tenantId/reportedByUserId) is
  // derived from the authenticated caller's own current residency at the
  // given property - never accepted from the client (spec: "these must
  // be derived from authenticated context").
  async create(
    user: AuthenticatedUser,
    dto: CreateComplaintDto,
  ): Promise<ComplaintResponseDto> {
    const tenant = await this.getCallerTenantOrThrow(user);

    // "The tenant may only create complaints for their own valid
    // active/current residency" (spec) - ACTIVE or NOTICE_PERIOD, never
    // a PENDING (not yet moved in) or CHECKED_OUT (no longer living
    // there) residency.
    const residency = await this.prisma.residency.findFirst({
      where: {
        tenantId: tenant.id,
        propertyId: dto.propertyId,
        status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      },
      include: { property: { select: { organizationId: true } } },
    });
    if (!residency) {
      throw new AppException(
        ErrorCode.COMPLAINT_INVALID_RESIDENCY_CONTEXT,
        'You do not have a current residency at this property.',
        HttpStatus.CONFLICT,
      );
    }
    const organizationId = residency.property.organizationId;

    if (user.platformRole !== 'SUPER_ADMIN') {
      const blocked =
        await this.subscriptions.isOrganizationWriteBlocked(organizationId);
      if (blocked) {
        throw new AppException(
          ErrorCode.SUBSCRIPTION_SUSPENDED,
          'This organization’s subscription is suspended. Ask the PG owner to restore access.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const { roomId, bedId } = await this.resolveRoomAndBed(dto, residency.id);

    // Never blindly trust a tenant-supplied URGENT (spec) - only
    // OWNER/MANAGER/STAFF can set URGENT, via the dedicated
    // priority-change action after triage.
    const priority =
      dto.priority === 'URGENT' ? 'HIGH' : (dto.priority ?? 'MEDIUM');

    const complaint = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: {
          organizationId,
          propertyId: dto.propertyId,
          residencyId: residency.id,
          tenantId: tenant.id,
          roomId,
          bedId,
          reportedByUserId: user.id,
          category: dto.category,
          priority,
          title: dto.title,
          description: dto.description,
        },
      });
      await this.activity.record(tx, {
        complaintId: created.id,
        actorUserId: user.id,
        type: 'CREATED',
        newStatus: created.status,
      });
      return created;
    });

    this.logger.log(
      `COMPLAINT_CREATED complaint=${complaint.id} organization=${organizationId} tenant=${tenant.id} by=${user.id}`,
    );
    return ComplaintResponseDto.fromEntity(complaint);
  }

  async findMany(
    user: AuthenticatedUser,
    query: ListComplaintsQueryDto,
  ): Promise<PaginatedResult<ComplaintResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where = await this.buildScopedWhere(user, query);

    const [rows, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortDir ?? 'desc' },
        skip,
        take,
      }),
      this.prisma.complaint.count({ where }),
    ]);

    return {
      items: rows.map(ComplaintResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOne(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.getAccessibleComplaintOrThrow(
      user,
      complaintId,
    );
    return ComplaintResponseDto.fromEntity(complaint);
  }

  // BOLA-safe lookup: fetched by id alone, then branched on the caller's
  // relationship to it - never scoped only to organization membership
  // (which would wrongly 404 a legitimate tenant, the same lesson Phase
  // 6 learned for tenant rent payments) and never trusted from an
  // unscoped `findUnique` alone (which would leak existence across
  // organizations/tenants).
  async getAccessibleComplaintOrThrow(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintWithTenant> {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!complaint) {
      throw this.notFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return complaint;
    }
    if (complaint.tenant.userId === user.id) {
      return complaint;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      complaint.organizationId,
    );
    if (membership) {
      return complaint;
    }
    throw this.notFound();
  }

  // For write actions restricted to OWNER/MANAGER/STAFF - never reachable
  // by the reporting tenant or by SUPER_ADMIN (spec: "Super Admin is
  // primarily global visibility/oversight... do not give Super Admin
  // arbitrary database mutation" - so no SUPER_ADMIN bypass here, unlike
  // the read path above).
  async getOrgComplaintForActionOrThrow(
    user: AuthenticatedUser,
    complaintId: string,
    allowedRoles: readonly string[],
  ): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId },
    });
    if (!complaint) {
      throw this.notFound();
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      complaint.organizationId,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw this.notFound();
    }
    return complaint;
  }

  async assertOrganizationWritableOrThrow(
    organizationId: string,
  ): Promise<void> {
    const blocked =
      await this.subscriptions.isOrganizationWriteBlocked(organizationId);
    if (blocked) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_SUSPENDED,
        'This organization’s subscription is suspended. Restore the subscription to resume complaint operations.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async resolveRoomAndBed(
    dto: CreateComplaintDto,
    residencyId: string,
  ): Promise<{ roomId: string | null; bedId: string | null }> {
    let roomId = dto.roomId ?? null;
    let bedId = dto.bedId ?? null;

    if (roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: roomId, propertyId: dto.propertyId },
      });
      if (!room) {
        throw new AppException(
          ErrorCode.ROOM_NOT_FOUND,
          'Room not found in this property.',
          HttpStatus.NOT_FOUND,
        );
      }
    }
    if (bedId) {
      const bed = await this.prisma.bed.findFirst({
        where: { id: bedId, ...(roomId ? { roomId } : {}) },
      });
      if (!bed) {
        throw new AppException(
          ErrorCode.BED_NOT_FOUND,
          'Bed not found in this room.',
          HttpStatus.NOT_FOUND,
        );
      }
      roomId = roomId ?? bed.roomId;
    }

    // Prefer deriving room/bed from the tenant's own active allocation
    // under this residency when the client didn't supply either (spec:
    // "prefer deriving room/bed from the active residency where
    // possible").
    if (!roomId && !bedId) {
      const allocation = await this.prisma.bedAllocation.findFirst({
        where: { residencyId, status: 'ACTIVE' },
        include: { bed: true },
      });
      if (allocation) {
        bedId = allocation.bedId;
        roomId = allocation.bed.roomId;
      }
    }

    return { roomId, bedId };
  }

  private async buildScopedWhere(
    user: AuthenticatedUser,
    query: ListComplaintsQueryDto,
  ): Promise<Prisma.ComplaintWhereInput> {
    const filters: Prisma.ComplaintWhereInput = {
      status: query.status,
      priority: query.priority,
      category: query.category,
      propertyId: query.propertyId,
      roomId: query.roomId,
      createdAt:
        query.createdFrom || query.createdTo
          ? {
              gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
              lte: query.createdTo ? new Date(query.createdTo) : undefined,
            }
          : undefined,
      OR: query.search
        ? [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    if (user.platformRole === 'SUPER_ADMIN') {
      if (query.assignedToUserId)
        filters.assignedToUserId = query.assignedToUserId;
      return filters;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    const organizationIds = await this.memberships.listActiveOrganizationIds(
      user.id,
    );

    if (tenant && organizationIds.length === 0) {
      // A pure tenant with no organization memberships anywhere - scoped
      // strictly to their own complaints.
      return { ...filters, tenantId: tenant.id };
    }
    if (organizationIds.length > 0) {
      if (query.assignedToUserId)
        filters.assignedToUserId = query.assignedToUserId;
      return { ...filters, organizationId: { in: organizationIds } };
    }
    // Neither a tenant nor an organization member - no complaints to see.
    return { ...filters, id: '00000000-0000-0000-0000-000000000000' };
  }

  private async getCallerTenantOrThrow(
    user: AuthenticatedUser,
  ): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    if (!tenant) {
      throw new AppException(
        ErrorCode.TENANT_NOT_FOUND,
        'You must have a tenant profile to report a complaint.',
        HttpStatus.NOT_FOUND,
      );
    }
    return tenant;
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.COMPLAINT_NOT_FOUND,
      'Complaint not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
