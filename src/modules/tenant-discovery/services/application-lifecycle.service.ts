import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { TenantApplication } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { TenantApplicationsService } from './tenant-applications.service';
import { ApplicationActivityService } from './application-activity.service';
import { RejectApplicationDto } from '../dto/reject-application.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';

const REVIEW_ROLES = ['OWNER', 'MANAGER'] as const;
// After 30 days with no decision, a stale SUBMITTED/UNDER_REVIEW
// application is swept to EXPIRED by expireStaleApplications - a plain
// service method, never wired to a cron/scheduler (no such infra exists
// in this project yet - see README's "Phase 12" known limitations).
const STALE_APPLICATION_DAYS = 30;

// Every transition here uses the same atomic-conditional-`updateMany`
// pattern ComplaintLifecycleService established (see its own doc comment)
// - the expected prior status is folded into the WHERE clause so two
// concurrent callers can never both "win" the same transition.
@Injectable()
export class ApplicationLifecycleService {
  private readonly logger = new Logger(ApplicationLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly applications: TenantApplicationsService,
    private readonly activity: ApplicationActivityService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  async review(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.applications.getOrgApplicationOrThrow(
      user,
      applicationId,
      REVIEW_ROLES,
    );
    await this.assertWritable(user, application.organizationId);

    const updated = await this.transition(
      application,
      ['SUBMITTED'],
      'UNDER_REVIEW',
      { reviewedByUserId: user.id, reviewedAt: new Date() },
      user.id,
      'APPLICATION_REVIEW_STARTED',
    );
    await this.eventBus.emit(NotificationType.APPLICATION_REVIEW_STARTED, {
      applicationId: updated.id,
    });
    return ApplicationResponseDto.fromEntity(updated);
  }

  async approve(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.applications.getOrgApplicationOrThrow(
      user,
      applicationId,
      REVIEW_ROLES,
    );
    await this.assertWritable(user, application.organizationId);

    // Does NOT create Residency/BedAllocation/Invoice/Payment - approval
    // only records a decision (spec, mandatory financial isolation).
    const updated = await this.transition(
      application,
      ['UNDER_REVIEW', 'VISIT_SCHEDULED'],
      'APPROVED',
      { reviewedByUserId: user.id, decisionAt: new Date() },
      user.id,
      'APPLICATION_APPROVED',
    );
    await this.eventBus.emit(NotificationType.APPLICATION_APPROVED, {
      applicationId: updated.id,
    });
    return ApplicationResponseDto.fromEntity(updated);
  }

  async reject(
    user: AuthenticatedUser,
    applicationId: string,
    dto: RejectApplicationDto,
  ): Promise<ApplicationResponseDto> {
    const application = await this.applications.getOrgApplicationOrThrow(
      user,
      applicationId,
      REVIEW_ROLES,
    );
    await this.assertWritable(user, application.organizationId);

    const updated = await this.transition(
      application,
      ['UNDER_REVIEW', 'VISIT_SCHEDULED'],
      'REJECTED',
      {
        reviewedByUserId: user.id,
        decisionAt: new Date(),
        rejectionReason: dto.reason ?? null,
      },
      user.id,
      'APPLICATION_REJECTED',
    );
    await this.eventBus.emit(NotificationType.APPLICATION_REJECTED, {
      applicationId: updated.id,
    });
    return ApplicationResponseDto.fromEntity(updated);
  }

  // Applicant-only, own application. SUBMITTED/UNDER_REVIEW/
  // VISIT_SCHEDULED -> WITHDRAWN. Cannot withdraw APPROVED/REJECTED
  // (terminal decision already made).
  async withdraw(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.applications.getApplicantApplicationOrThrow(
      user,
      applicationId,
    );
    if (
      !['SUBMITTED', 'UNDER_REVIEW', 'VISIT_SCHEDULED'].includes(
        application.status,
      )
    ) {
      throw new AppException(
        ErrorCode.APPLICATION_NOT_WITHDRAWABLE,
        `Cannot withdraw an application in status ${application.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.transition(
      application,
      ['SUBMITTED', 'UNDER_REVIEW', 'VISIT_SCHEDULED'],
      'WITHDRAWN',
      {},
      user.id,
      'APPLICATION_WITHDRAWN',
    );
    return ApplicationResponseDto.fromEntity(updated);
  }

  // No cron/scheduler infrastructure exists in this project (spec: do not
  // add a new dependency for this) - this is a plain, callable method a
  // future scheduled job can invoke once such infra exists. Deliberately
  // bulk (`updateMany`), not one row at a time - there is no per-row
  // side effect other than the status change and an activity record is
  // not written per-row here to keep a bulk sweep O(1) queries; the
  // activity trail's SUBMITTED/REVIEW rows already establish the
  // application's history up to this point.
  async expireStaleApplications(): Promise<{ expired: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_APPLICATION_DAYS);
    const result = await this.prisma.tenantApplication.updateMany({
      where: {
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        createdAt: { lt: cutoff },
      },
      data: { status: 'EXPIRED', decisionAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`APPLICATIONS_EXPIRED count=${result.count}`);
    }
    return { expired: result.count };
  }

  private async transition(
    application: TenantApplication,
    fromStatuses: string[],
    toStatus: string,
    extraData: Record<string, unknown>,
    actorUserId: string,
    activityAction: string,
  ): Promise<TenantApplication> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.tenantApplication.updateMany({
        where: { id: application.id, status: { in: fromStatuses as never } },
        data: { status: toStatus as never, ...extraData },
      });
      if (result.count === 0) {
        return null;
      }
      await this.activity.record(tx, {
        applicationId: application.id,
        actorUserId,
        action: activityAction,
      });
      return tx.tenantApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
    });
    if (!updated) {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_STATE,
        `Cannot transition an application from ${application.status} to ${toStatus}.`,
        HttpStatus.CONFLICT,
      );
    }
    this.logger.log(
      `APPLICATION_${toStatus} application=${application.id} by=${actorUserId}`,
    );
    return updated;
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
}
