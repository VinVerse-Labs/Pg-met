import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, TenantApplication } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  normalizeEmail,
  normalizePhone,
} from '../../users/users.normalization';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { PublicDiscoveryService } from './public-discovery.service';
import { ApplicationActivityService } from './application-activity.service';
import { SubmitApplicationDto } from '../dto/submit-application.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';
import { ListApplicationsQueryDto } from '../dto/list-applications.query.dto';

const READ_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
const ACTIVE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VISIT_SCHEDULED',
  'APPROVED',
] as const;
const DUPLICATE_INDEX_NAME =
  'tenant_applications_active_applicant_property_unique';

@Injectable()
export class TenantApplicationsService {
  private readonly logger = new Logger(TenantApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly discovery: PublicDiscoveryService,
    private readonly activity: ApplicationActivityService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // The one and only application-creation path - reachable from both a
  // guest (no `applicantUserId`) and an authenticated applicant (auto-
  // linked). Re-validates the property is genuinely publishable right now
  // (spec: never trust the absence of a guard alone) rather than trusting
  // that the client reached this endpoint from a currently-published
  // listing page.
  async create(
    propertyId: string,
    dto: SubmitApplicationDto,
    applicantUserId: string | null,
  ): Promise<ApplicationResponseDto> {
    const { organizationId, listingId } =
      await this.discovery.assertApplicable(propertyId);

    const phone = normalizePhone(dto.phone);
    const email = dto.email ? normalizeEmail(dto.email) : null;

    try {
      const application = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenantApplication.create({
          data: {
            organizationId,
            propertyId,
            propertyListingId: listingId,
            applicantUserId,
            fullName: dto.fullName,
            phone,
            email,
            preferredMoveInDate: dto.preferredMoveInDate
              ? new Date(dto.preferredMoveInDate)
              : null,
            preferredRoomType: dto.preferredRoomType,
            preferredStayDuration: dto.preferredStayDuration,
            notes: dto.notes,
          },
        });
        await this.activity.record(tx, {
          applicationId: created.id,
          actorUserId: applicantUserId,
          action: 'APPLICATION_SUBMITTED',
        });
        return created;
      });

      this.logger.log(
        `APPLICATION_SUBMITTED application=${application.id} property=${propertyId}`,
      );
      await this.eventBus.emit(NotificationType.APPLICATION_SUBMITTED, {
        applicationId: application.id,
      });
      return ApplicationResponseDto.fromEntity(application);
    } catch (error) {
      if (this.isUniqueViolation(error, DUPLICATE_INDEX_NAME)) {
        // Deliberately generic - never leaks "an application already
        // exists for this phone" (spec).
        throw new AppException(
          ErrorCode.APPLICATION_ALREADY_EXISTS,
          'An application for this property already exists.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findManyForOrg(
    user: AuthenticatedUser,
    propertyId: string,
    query: ListApplicationsQueryDto,
  ): Promise<PaginatedResult<ApplicationResponseDto>> {
    await this.assertPropertyRole(user, propertyId, READ_ROLES);
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.TenantApplicationWhereInput = {
      propertyId,
      status: query.status,
      preferredRoomType: query.preferredRoomType,
      createdAt:
        query.createdFrom || query.createdTo
          ? {
              gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
              lte: query.createdTo ? new Date(query.createdTo) : undefined,
            }
          : undefined,
      preferredMoveInDate:
        query.preferredMoveInFrom || query.preferredMoveInTo
          ? {
              gte: query.preferredMoveInFrom
                ? new Date(query.preferredMoveInFrom)
                : undefined,
              lte: query.preferredMoveInTo
                ? new Date(query.preferredMoveInTo)
                : undefined,
            }
          : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenantApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.tenantApplication.count({ where }),
    ]);
    return {
      items: rows.map(ApplicationResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  // BOLA-safe: fetched by id alone, then branched on the caller's
  // relationship to it (org member of the owning organization, or
  // SUPER_ADMIN) - never scoped only to organization membership up front.
  async getOrgApplicationOrThrow(
    user: AuthenticatedUser,
    applicationId: string,
    allowedRoles: readonly string[] = READ_ROLES,
  ): Promise<TenantApplication> {
    const application = await this.prisma.tenantApplication.findFirst({
      where: { id: applicationId },
    });
    if (!application) {
      throw this.notFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return application;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      application.organizationId,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw this.notFound();
    }
    return application;
  }

  async findOneForOrg(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.getOrgApplicationOrThrow(
      user,
      applicationId,
    );
    return ApplicationResponseDto.fromEntity(application);
  }

  async findManyForApplicant(
    user: AuthenticatedUser,
    query: ListApplicationsQueryDto,
  ): Promise<PaginatedResult<ApplicationResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.TenantApplicationWhereInput = {
      applicantUserId: user.id,
      status: query.status,
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenantApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.tenantApplication.count({ where }),
    ]);
    return {
      items: rows.map(ApplicationResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  // BOLA-safe applicant scoping: 404 (not 403) for another applicant's
  // application - identical convention to every other cross-tenant check
  // in this codebase.
  async getApplicantApplicationOrThrow(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<TenantApplication> {
    const application = await this.prisma.tenantApplication.findFirst({
      where: { id: applicationId, applicantUserId: user.id },
    });
    if (!application) {
      throw this.notFound();
    }
    return application;
  }

  async findOneForApplicant(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    const application = await this.getApplicantApplicationOrThrow(
      user,
      applicationId,
    );
    return ApplicationResponseDto.fromEntity(application);
  }

  async assertPropertyRole(
    user: AuthenticatedUser,
    propertyId: string,
    allowedRoles: readonly string[],
  ): Promise<string> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { organizationId: true },
    });
    if (!property) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return property.organizationId;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      property.organizationId,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return property.organizationId;
  }

  isActiveStatus(status: string): boolean {
    return (ACTIVE_STATUSES as readonly string[]).includes(status);
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.APPLICATION_NOT_FOUND,
      'Application not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private isUniqueViolation(error: unknown, indexName: string): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') return target.includes(indexName);
    if (Array.isArray(target)) return target.includes(indexName);
    return false;
  }
}
