import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, PropertyVisit } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  PaginatedResult,
  PaginationQueryDto,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { TenantApplicationsService } from './tenant-applications.service';
import {
  CancelVisitDto,
  RequestVisitDto,
  ScheduleVisitDto,
} from '../dto/schedule-visit.dto';
import { VisitResponseDto } from '../dto/visit-response.dto';

const MANAGE_ROLES = ['OWNER', 'MANAGER'] as const;
const READ_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;

// Site-visit scheduling for an application. Conflict detection (no two
// SCHEDULED visits at the same property with overlapping time ranges) is
// enforced inside a transaction guarded by a Postgres advisory lock keyed
// by propertyId (`pg_advisory_xact_lock(hashtext(propertyId))`) - this
// closes the SELECT-then-write race window a plain application-level
// check would leave open under real concurrent scheduling requests (spec's
// mandatory concurrency test), mirroring the level of rigor
// BedAllocation's partial-unique-index + transaction combination already
// established for a structurally different kind of conflict (Postgres has
// no way to express "no overlapping ranges" as a plain unique index).
@Injectable()
export class PropertyVisitsService {
  private readonly logger = new Logger(PropertyVisitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly applications: TenantApplicationsService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // Applicant requests a visit - REQUESTED, no time yet.
  async request(
    user: AuthenticatedUser,
    applicationId: string,
    dto: RequestVisitDto,
  ): Promise<VisitResponseDto> {
    const application = await this.applications.getApplicantApplicationOrThrow(
      user,
      applicationId,
    );
    if (!this.applications.isActiveStatus(application.status)) {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_STATE,
        'Cannot request a visit for this application.',
        HttpStatus.CONFLICT,
      );
    }
    const visit = await this.prisma.propertyVisit.create({
      data: {
        organizationId: application.organizationId,
        propertyId: application.propertyId,
        applicationId: application.id,
        applicantUserId: user.id,
        notes: dto.notes,
        createdByUserId: user.id,
        status: 'REQUESTED',
      },
    });
    return VisitResponseDto.fromEntity(visit);
  }

  // Owner/manager schedules directly - straight to SCHEDULED with a time.
  async scheduleNew(
    user: AuthenticatedUser,
    applicationId: string,
    dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    const application = await this.applications.getOrgApplicationOrThrow(
      user,
      applicationId,
      MANAGE_ROLES,
    );
    await this.assertWritable(user, application.organizationId);
    const { start, end } = this.parseRange(dto);

    const visit = await this.prisma.$transaction(async (tx) => {
      await this.lockProperty(tx, application.propertyId);
      await this.assertNoConflict(tx, application.propertyId, start, end, null);
      const created = await tx.propertyVisit.create({
        data: {
          organizationId: application.organizationId,
          propertyId: application.propertyId,
          applicationId: application.id,
          applicantUserId: application.applicantUserId,
          scheduledStartAt: start,
          scheduledEndAt: end,
          notes: dto.notes,
          createdByUserId: user.id,
          status: 'SCHEDULED',
        },
      });
      await tx.tenantApplication.updateMany({
        where: {
          id: application.id,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        },
        data: { status: 'VISIT_SCHEDULED' },
      });
      return created;
    });

    this.logger.log(
      `VISIT_SCHEDULED visit=${visit.id} application=${application.id} by=${user.id}`,
    );
    await this.eventBus.emit(NotificationType.VISIT_SCHEDULED, {
      visitId: visit.id,
    });
    return VisitResponseDto.fromEntity(visit);
  }

  // REQUESTED -> SCHEDULED (owner/manager confirms a time for a request).
  async confirm(
    user: AuthenticatedUser,
    visitId: string,
    dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    const visit = await this.getOrgVisitOrThrow(user, visitId, MANAGE_ROLES);
    await this.assertWritable(user, visit.organizationId);
    const { start, end } = this.parseRange(dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockProperty(tx, visit.propertyId);
      await this.assertNoConflict(tx, visit.propertyId, start, end, visit.id);
      const result = await tx.propertyVisit.updateMany({
        where: { id: visitId, status: 'REQUESTED' },
        data: {
          status: 'SCHEDULED',
          scheduledStartAt: start,
          scheduledEndAt: end,
        },
      });
      if (result.count === 0) return null;
      await tx.tenantApplication.updateMany({
        where: {
          id: visit.applicationId,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        },
        data: { status: 'VISIT_SCHEDULED' },
      });
      return tx.propertyVisit.findUniqueOrThrow({ where: { id: visitId } });
    });
    if (!updated) {
      throw this.invalidTransition(visit.status, 'SCHEDULED');
    }
    await this.eventBus.emit(NotificationType.VISIT_SCHEDULED, {
      visitId: updated.id,
    });
    return VisitResponseDto.fromEntity(updated);
  }

  // SCHEDULED -> SCHEDULED (same row, new time) - never creates a new row.
  async reschedule(
    user: AuthenticatedUser,
    visitId: string,
    dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    const visit = await this.getOrgVisitOrThrow(user, visitId, MANAGE_ROLES);
    await this.assertWritable(user, visit.organizationId);
    const { start, end } = this.parseRange(dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockProperty(tx, visit.propertyId);
      await this.assertNoConflict(tx, visit.propertyId, start, end, visit.id);
      const result = await tx.propertyVisit.updateMany({
        where: { id: visitId, status: 'SCHEDULED' },
        data: {
          scheduledStartAt: start,
          scheduledEndAt: end,
          notes: dto.notes,
        },
      });
      if (result.count === 0) return null;
      return tx.propertyVisit.findUniqueOrThrow({ where: { id: visitId } });
    });
    if (!updated) {
      throw this.invalidTransition(visit.status, 'SCHEDULED');
    }
    await this.eventBus.emit(NotificationType.VISIT_RESCHEDULED, {
      visitId: updated.id,
    });
    return VisitResponseDto.fromEntity(updated);
  }

  async complete(
    user: AuthenticatedUser,
    visitId: string,
  ): Promise<VisitResponseDto> {
    const visit = await this.getOrgVisitOrThrow(user, visitId, MANAGE_ROLES);
    await this.assertWritable(user, visit.organizationId);
    const updated = await this.transitionMany(
      visitId,
      ['SCHEDULED'],
      'COMPLETED',
    );
    if (!updated) throw this.invalidTransition(visit.status, 'COMPLETED');
    return VisitResponseDto.fromEntity(updated);
  }

  async noShow(
    user: AuthenticatedUser,
    visitId: string,
  ): Promise<VisitResponseDto> {
    const visit = await this.getOrgVisitOrThrow(user, visitId, MANAGE_ROLES);
    await this.assertWritable(user, visit.organizationId);
    const updated = await this.transitionMany(
      visitId,
      ['SCHEDULED'],
      'NO_SHOW',
    );
    if (!updated) throw this.invalidTransition(visit.status, 'NO_SHOW');
    await this.eventBus.emit(NotificationType.VISIT_NO_SHOW, {
      visitId: updated.id,
    });
    return VisitResponseDto.fromEntity(updated);
  }

  // Either side (applicant or owner/manager) may cancel their own /
  // in-scope visit, from REQUESTED or SCHEDULED.
  async cancel(
    user: AuthenticatedUser,
    visitId: string,
    dto: CancelVisitDto,
  ): Promise<VisitResponseDto> {
    const visit = await this.prisma.propertyVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) {
      throw this.notFound();
    }
    const isApplicant = visit.applicantUserId === user.id;
    if (!isApplicant) {
      if (user.platformRole !== 'SUPER_ADMIN') {
        const membership = await this.memberships.getActiveMembership(
          user.id,
          visit.organizationId,
        );
        if (!membership || !MANAGE_ROLES.includes(membership.role as never)) {
          throw this.notFound();
        }
      }
    }
    const updated = await this.prisma.propertyVisit.updateMany({
      where: { id: visitId, status: { in: ['REQUESTED', 'SCHEDULED'] } },
      data: { status: 'CANCELLED', cancelReason: dto.reason },
    });
    if (updated.count === 0) {
      throw this.invalidTransition(visit.status, 'CANCELLED');
    }
    const fresh = await this.prisma.propertyVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    await this.eventBus.emit(NotificationType.VISIT_CANCELLED, {
      visitId: fresh.id,
    });
    return VisitResponseDto.fromEntity(fresh);
  }

  async findManyForOrg(
    user: AuthenticatedUser,
    propertyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<VisitResponseDto>> {
    await this.applications.assertPropertyRole(user, propertyId, READ_ROLES);
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.PropertyVisitWhereInput = { propertyId };
    const [rows, total] = await Promise.all([
      this.prisma.propertyVisit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.propertyVisit.count({ where }),
    ]);
    return {
      items: rows.map(VisitResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOneForOrg(
    user: AuthenticatedUser,
    visitId: string,
  ): Promise<VisitResponseDto> {
    const visit = await this.getOrgVisitOrThrow(user, visitId, READ_ROLES);
    return VisitResponseDto.fromEntity(visit);
  }

  async findManyForApplicant(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<VisitResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.PropertyVisitWhereInput = { applicantUserId: user.id };
    const [rows, total] = await Promise.all([
      this.prisma.propertyVisit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.propertyVisit.count({ where }),
    ]);
    return {
      items: rows.map(VisitResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOneForApplicant(
    user: AuthenticatedUser,
    visitId: string,
  ): Promise<VisitResponseDto> {
    const visit = await this.prisma.propertyVisit.findFirst({
      where: { id: visitId, applicantUserId: user.id },
    });
    if (!visit) throw this.notFound();
    return VisitResponseDto.fromEntity(visit);
  }

  private async getOrgVisitOrThrow(
    user: AuthenticatedUser,
    visitId: string,
    allowedRoles: readonly string[],
  ): Promise<PropertyVisit> {
    const visit = await this.prisma.propertyVisit.findFirst({
      where: { id: visitId },
    });
    if (!visit) throw this.notFound();
    if (user.platformRole === 'SUPER_ADMIN') return visit;
    const membership = await this.memberships.getActiveMembership(
      user.id,
      visit.organizationId,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw this.notFound();
    }
    return visit;
  }

  private async transitionMany(
    visitId: string,
    fromStatuses: string[],
    toStatus: string,
  ): Promise<PropertyVisit | null> {
    const result = await this.prisma.propertyVisit.updateMany({
      where: { id: visitId, status: { in: fromStatuses as never } },
      data: { status: toStatus as never },
    });
    if (result.count === 0) return null;
    return this.prisma.propertyVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
  }

  private parseRange(dto: ScheduleVisitDto): { start: Date; end: Date } {
    const start = new Date(dto.scheduledStartAt);
    const end = new Date(dto.scheduledEndAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppException(
        ErrorCode.VISIT_TIME_REQUIRED,
        'A valid scheduledStartAt/scheduledEndAt is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (end <= start) {
      throw new AppException(
        ErrorCode.VISIT_TIME_REQUIRED,
        'scheduledEndAt must be after scheduledStartAt.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { start, end };
  }

  // Advisory lock keyed by propertyId so two concurrent scheduling
  // requests for the SAME property serialize on this check - requests for
  // different properties never contend with each other.
  private async lockProperty(
    tx: Prisma.TransactionClient,
    propertyId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`;
  }

  private async assertNoConflict(
    tx: Prisma.TransactionClient,
    propertyId: string,
    start: Date,
    end: Date,
    excludeVisitId: string | null,
  ): Promise<void> {
    const conflict = await tx.propertyVisit.findFirst({
      where: {
        propertyId,
        status: 'SCHEDULED',
        id: excludeVisitId ? { not: excludeVisitId } : undefined,
        scheduledStartAt: { lt: end },
        scheduledEndAt: { gt: start },
      },
    });
    if (conflict) {
      throw new AppException(
        ErrorCode.VISIT_TIME_CONFLICT,
        'Another visit is already scheduled for this property in the requested time range.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async assertWritable(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') return;
    const blocked =
      await this.subscriptions.isOrganizationWriteBlocked(organizationId);
    if (blocked) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_SUSPENDED,
        'This organization’s subscription is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private invalidTransition(from: string, to: string): AppException {
    return new AppException(
      ErrorCode.VISIT_INVALID_STATE,
      `Cannot transition a visit from ${from} to ${to}.`,
      HttpStatus.CONFLICT,
    );
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.VISIT_NOT_FOUND,
      'Visit not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
