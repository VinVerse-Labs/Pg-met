import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Complaint, ComplaintStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintsService, ORG_COMPLAINT_ROLES } from './complaints.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { AssignComplaintDto } from './dto/assign-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { ChangePriorityDto } from './dto/change-priority.dto';
import { ComplaintResponseDto } from './dto/complaint-response.dto';

const ASSIGN_ROLES = ['OWNER', 'MANAGER'] as const;

// Every transition here uses the same atomic-conditional-`updateMany`
// pattern Phase 8 had to introduce after its own find-then-write race
// (see README's "Phase 8" Key Decision) - the expected prior status is
// folded into the `WHERE` clause so the transition itself is the atomic,
// database-enforced unit. Two concurrent callers can both pass the
// authorization/role checks (those don't mutate anything), but only one
// `updateMany` call ever matches a row; the loser's `count === 0` is
// translated into the same domain error a sequential duplicate call
// would see - never a silent double-transition, never inconsistent
// activity history (spec's mandatory concurrency tests 3 and 4).
@Injectable()
export class ComplaintLifecycleService {
  private readonly logger = new Logger(ComplaintLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly complaints: ComplaintsService,
    private readonly activity: ComplaintActivityService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // Assigning also transitions OPEN -> ASSIGNED (spec's lifecycle
  // diagram folds these into one step) - re-assigning an already-ASSIGNED
  // complaint to someone else is allowed (status stays ASSIGNED), but
  // once work has started (IN_PROGRESS or later) the assignee is fixed
  // for the rest of this phase's simple workflow.
  async assign(
    user: AuthenticatedUser,
    complaintId: string,
    dto: AssignComplaintDto,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.complaints.getOrgComplaintForActionOrThrow(
      user,
      complaintId,
      ASSIGN_ROLES,
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    if (!['OPEN', 'ASSIGNED'].includes(complaint.status)) {
      throw this.invalidTransition(complaint.status, 'ASSIGNED');
    }

    const assigneeMembership = await this.memberships.getActiveMembership(
      dto.assignedToUserId,
      complaint.organizationId,
    );
    if (!assigneeMembership) {
      throw new AppException(
        ErrorCode.COMPLAINT_ASSIGNEE_NOT_IN_ORGANIZATION,
        'The assignee is not an active member of this organization.',
        HttpStatus.CONFLICT,
      );
    }
    if (!ORG_COMPLAINT_ROLES.includes(assigneeMembership.role as never)) {
      throw new AppException(
        ErrorCode.COMPLAINT_ASSIGNMENT_NOT_ALLOWED,
        'This member’s role cannot be assigned complaints.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.complaint.updateMany({
        where: { id: complaintId, status: { in: ['OPEN', 'ASSIGNED'] } },
        data: { assignedToUserId: dto.assignedToUserId, status: 'ASSIGNED' },
      });
      if (result.count === 0) {
        return null;
      }
      await this.activity.record(tx, {
        complaintId,
        actorUserId: user.id,
        type: 'ASSIGNED',
        oldStatus: complaint.status,
        newStatus: 'ASSIGNED',
        oldAssigneeId: complaint.assignedToUserId,
        newAssigneeId: dto.assignedToUserId,
      });
      return tx.complaint.findUniqueOrThrow({ where: { id: complaintId } });
    });

    if (!updated) {
      throw this.invalidTransition(complaint.status, 'ASSIGNED');
    }
    this.logger.log(
      `COMPLAINT_ASSIGNED complaint=${complaintId} assignee=${dto.assignedToUserId} by=${user.id}`,
    );
    await this.eventBus.emit(NotificationType.COMPLAINT_ASSIGNED, {
      complaintId,
    });
    return ComplaintResponseDto.fromEntity(updated);
  }

  async unassign(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.complaints.getOrgComplaintForActionOrThrow(
      user,
      complaintId,
      ASSIGN_ROLES,
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.complaint.updateMany({
        where: { id: complaintId, status: 'ASSIGNED' },
        data: { assignedToUserId: null, status: 'OPEN' },
      });
      if (result.count === 0) {
        return null;
      }
      await this.activity.record(tx, {
        complaintId,
        actorUserId: user.id,
        type: 'UNASSIGNED',
        oldStatus: 'ASSIGNED',
        newStatus: 'OPEN',
        oldAssigneeId: complaint.assignedToUserId,
        newAssigneeId: null,
      });
      return tx.complaint.findUniqueOrThrow({ where: { id: complaintId } });
    });

    if (!updated) {
      throw this.invalidTransition(complaint.status, 'OPEN');
    }
    return ComplaintResponseDto.fromEntity(updated);
  }

  async changePriority(
    user: AuthenticatedUser,
    complaintId: string,
    dto: ChangePriorityDto,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.complaints.getOrgComplaintForActionOrThrow(
      user,
      complaintId,
      ['OWNER', 'MANAGER'],
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    if (['CLOSED', 'CANCELLED'].includes(complaint.status)) {
      throw new AppException(
        ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
        'Cannot change the priority of a closed or cancelled complaint.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.complaint.update({
        where: { id: complaintId },
        data: { priority: dto.priority },
      });
      await this.activity.record(tx, {
        complaintId,
        actorUserId: user.id,
        type: 'PRIORITY_CHANGED',
        oldPriority: complaint.priority,
        newPriority: dto.priority,
      });
      return result;
    });
    return ComplaintResponseDto.fromEntity(updated);
  }

  // ASSIGNED -> IN_PROGRESS. STAFF may only start a complaint assigned to
  // themselves (spec: STAFF's "UPDATE allowed status" is scoped to
  // complaints assigned to them); OWNER/MANAGER may start any complaint
  // in their organization.
  async start(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.getComplaintForStaffActionOrThrow(
      user,
      complaintId,
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    return this.transition(user, complaint, 'ASSIGNED', 'IN_PROGRESS', {});
  }

  async resolve(
    user: AuthenticatedUser,
    complaintId: string,
    dto: ResolveComplaintDto,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.getComplaintForStaffActionOrThrow(
      user,
      complaintId,
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    return this.transition(user, complaint, 'IN_PROGRESS', 'RESOLVED', {
      resolutionNote: dto.resolutionNote,
      resolvedAt: new Date(),
    });
  }

  async close(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.complaints.getOrgComplaintForActionOrThrow(
      user,
      complaintId,
      ['OWNER', 'MANAGER'],
    );
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    return this.transition(user, complaint, 'RESOLVED', 'CLOSED', {
      closedAt: new Date(),
    });
  }

  // OPEN -> CANCELLED only (spec's workflow shows no other origin state)
  // - by the reporting tenant themselves, or by OWNER/MANAGER.
  async cancel(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!complaint) {
      throw new AppException(
        ErrorCode.COMPLAINT_NOT_FOUND,
        'Complaint not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const isOwnComplaint = complaint.tenant.userId === user.id;
    if (!isOwnComplaint) {
      const membership = await this.memberships.getActiveMembership(
        user.id,
        complaint.organizationId,
      );
      if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
        throw new AppException(
          ErrorCode.COMPLAINT_NOT_FOUND,
          'Complaint not found.',
          HttpStatus.NOT_FOUND,
        );
      }
    }
    await this.complaints.assertOrganizationWritableOrThrow(
      complaint.organizationId,
    );
    return this.transition(user, complaint, 'OPEN', 'CANCELLED', {});
  }

  private async transition(
    user: AuthenticatedUser,
    complaint: Complaint,
    fromStatus: ComplaintStatus,
    toStatus: ComplaintStatus,
    extraData: Record<string, unknown>,
  ): Promise<ComplaintResponseDto> {
    if (complaint.status !== fromStatus) {
      throw this.invalidTransition(complaint.status, toStatus);
    }

    const activityType =
      toStatus === 'RESOLVED'
        ? 'RESOLVED'
        : toStatus === 'CLOSED'
          ? 'CLOSED'
          : toStatus === 'CANCELLED'
            ? 'CANCELLED'
            : 'STATUS_CHANGED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.complaint.updateMany({
        where: { id: complaint.id, status: fromStatus },
        data: { status: toStatus, ...extraData },
      });
      if (result.count === 0) {
        return null;
      }
      await this.activity.record(tx, {
        complaintId: complaint.id,
        actorUserId: user.id,
        type: activityType,
        oldStatus: fromStatus,
        newStatus: toStatus,
      });
      return tx.complaint.findUniqueOrThrow({ where: { id: complaint.id } });
    });

    if (!updated) {
      throw this.invalidTransition(complaint.status, toStatus);
    }
    this.logger.log(
      `COMPLAINT_STATUS_CHANGED complaint=${complaint.id} ${fromStatus}->${toStatus} by=${user.id}`,
    );
    // Only the tenant-facing terminal/status transitions notify (spec
    // section 39/68) - CANCELLED has no dedicated notification type in
    // this phase's spec (the cancelling actor, tenant or OWNER/MANAGER,
    // already knows), so it is deliberately the one transition this
    // switch does not emit for.
    if (toStatus === 'RESOLVED') {
      await this.eventBus.emit(NotificationType.COMPLAINT_RESOLVED, {
        complaintId: complaint.id,
      });
    } else if (toStatus === 'CLOSED') {
      await this.eventBus.emit(NotificationType.COMPLAINT_CLOSED, {
        complaintId: complaint.id,
      });
    } else if (toStatus === 'IN_PROGRESS') {
      await this.eventBus.emit(NotificationType.COMPLAINT_STATUS_CHANGED, {
        complaintId: complaint.id,
      });
    }
    return ComplaintResponseDto.fromEntity(updated);
  }

  private async getComplaintForStaffActionOrThrow(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findFirst({
      where: { id: complaintId },
    });
    if (!complaint) {
      throw new AppException(
        ErrorCode.COMPLAINT_NOT_FOUND,
        'Complaint not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      complaint.organizationId,
    );
    if (
      !membership ||
      !ORG_COMPLAINT_ROLES.includes(membership.role as never)
    ) {
      throw new AppException(
        ErrorCode.COMPLAINT_NOT_FOUND,
        'Complaint not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (membership.role === 'STAFF' && complaint.assignedToUserId !== user.id) {
      throw new AppException(
        ErrorCode.COMPLAINT_ASSIGNMENT_NOT_ALLOWED,
        'STAFF may only act on complaints assigned to themselves.',
        HttpStatus.FORBIDDEN,
      );
    }
    return complaint;
  }

  private invalidTransition(
    from: ComplaintStatus,
    to: ComplaintStatus,
  ): AppException {
    return new AppException(
      ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
      `Cannot transition a complaint from ${from} to ${to}.`,
      HttpStatus.CONFLICT,
    );
  }
}
