import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AdminOrganizationsQueryDto } from './dto/admin-organizations-query.dto';
import {
  AdminOrganizationDetailResponseDto,
  AdminOrganizationListItemDto,
} from './dto/admin-organization-response.dto';
import { AdminOwnersQueryDto } from './dto/admin-owners-query.dto';
import { AdminOwnerResponseDto } from './dto/admin-owner-response.dto';
import { AdminPropertiesQueryDto } from './dto/admin-properties-query.dto';
import { AdminPropertyResponseDto } from './dto/admin-property-response.dto';
import { AdminSubscriptionsQueryDto } from './dto/admin-subscriptions-query.dto';
import { AdminSubscriptionResponseDto } from './dto/admin-subscription-response.dto';

// The platform-level counterpart to every organization-scoped service in
// this codebase (PropertiesService, ResidenciesService, etc.) - reads and
// mutates data *across* organizations, which is exactly the capability no
// other service in this project is allowed to have (spec: "Super Admin
// should not be implemented by simply bypassing all authorization checks
// inside existing owner services. Create explicit platform-level
// services/queries."). Every query here is intentionally its own
// database-level aggregation - never "load everything, then filter/count
// in Node" (spec's explicit performance requirement).
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ------------------------------------------------------------------
  // Organizations
  // ------------------------------------------------------------------

  async findOrganizations(
    query: AdminOrganizationsQueryDto,
  ): Promise<PaginatedResult<AdminOrganizationListItemDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.OrganizationWhereInput = {
      status: query.status,
      createdAt:
        query.createdFrom || query.createdTo
          ? {
              gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
              lte: query.createdTo ? new Date(query.createdTo) : undefined,
            }
          : undefined,
      subscription: query.subscriptionStatus
        ? { status: query.subscriptionStatus }
        : undefined,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            {
              memberships: {
                some: {
                  role: 'OWNER',
                  user: {
                    OR: [
                      { name: { contains: query.search, mode: 'insensitive' } },
                      {
                        email: { contains: query.search, mode: 'insensitive' },
                      },
                    ],
                  },
                },
              },
            },
          ]
        : undefined,
    };

    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: {
          subscription: { select: { status: true } },
          _count: { select: { properties: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      items: rows.map((org) => ({
        id: org.id,
        name: org.name,
        status: org.status,
        subscriptionStatus: org.subscription?.status ?? null,
        propertyCount: org._count.properties,
        createdAt: org.createdAt,
      })),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOrganizationDetail(
    organizationId: string,
  ): Promise<AdminOrganizationDetailResponseDto> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        memberships: {
          where: { role: 'OWNER', status: 'ACTIVE' },
          include: { user: { select: { id: true, name: true, email: true } } },
          take: 1,
        },
        subscription: { include: { saasPlan: { select: { name: true } } } },
        _count: { select: { properties: true } },
      },
    });
    if (!organization) {
      throw this.organizationNotFound();
    }

    const [roomCount, bedCount, occupiedBedCount, tenantCount] =
      await Promise.all([
        this.prisma.room.count({
          where: { property: { organizationId } },
        }),
        this.prisma.bed.count({
          where: { room: { property: { organizationId } } },
        }),
        this.prisma.bed.count({
          where: {
            room: { property: { organizationId } },
            allocations: { some: { status: 'ACTIVE' } },
          },
        }),
        this.prisma.residency
          .findMany({
            where: { property: { organizationId } },
            select: { tenantId: true },
            distinct: ['tenantId'],
          })
          .then((rows) => rows.length),
      ]);

    const owner = organization.memberships[0]?.user ?? null;

    return {
      id: organization.id,
      name: organization.name,
      status: organization.status,
      createdAt: organization.createdAt,
      owner: owner
        ? { userId: owner.id, name: owner.name, email: owner.email }
        : null,
      subscription: organization.subscription
        ? {
            planName: organization.subscription.saasPlan.name,
            status: organization.subscription.status,
            currentPeriodEnd: organization.subscription.currentPeriodEnd,
            nextBillingAt: organization.subscription.nextBillingAt,
            gracePeriodEndsAt: organization.subscription.gracePeriodEndsAt,
          }
        : null,
      propertyCount: organization._count.properties,
      roomCount,
      bedCount,
      occupiedBedCount,
      tenantCount,
      occupancyPercentage:
        bedCount > 0
          ? Math.round((occupiedBedCount / bedCount) * 1000) / 10
          : 0,
    };
  }

  // A plain "find, check status, then update" here has a genuine race
  // window: two concurrent suspend requests can both read `status:
  // ACTIVE` before either writes, and both would then "succeed" -
  // including writing two audit log entries for what should be one
  // state change (caught by running this exact scenario concurrently
  // against real Postgres - spec's "Test 5: concurrent admin state
  // change"). `updateMany` with the expected prior status folded into
  // its own `WHERE` clause makes the transition itself atomic: exactly
  // one concurrent caller's row matches and flips, the other matches
  // zero rows and is told ALREADY_SUSPENDED - the same "the database
  // clause is the real guarantee" principle every other concurrency-
  // sensitive mutation in this codebase uses, applied here without
  // needing a unique index or a row lock, since a single boolean-ish
  // status column only ever needs a conditional UPDATE.
  async suspendOrganization(
    admin: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, status: { not: 'SUSPENDED' } },
      data: { status: 'SUSPENDED' },
    });
    if (result.count === 0) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization) {
        throw this.organizationNotFound();
      }
      throw new AppException(
        ErrorCode.ORGANIZATION_ALREADY_SUSPENDED,
        'This organization is already suspended.',
        HttpStatus.CONFLICT,
      );
    }

    await this.auditLog.record({
      actorUserId: admin.id,
      action: 'ORGANIZATION_SUSPENDED',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
    });
  }

  async activateOrganization(
    admin: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, status: { not: 'ACTIVE' } },
      data: { status: 'ACTIVE' },
    });
    if (result.count === 0) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization) {
        throw this.organizationNotFound();
      }
      throw new AppException(
        ErrorCode.ORGANIZATION_ALREADY_ACTIVE,
        'This organization is already active.',
        HttpStatus.CONFLICT,
      );
    }

    await this.auditLog.record({
      actorUserId: admin.id,
      action: 'ORGANIZATION_ACTIVATED',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
    });
  }

  // ------------------------------------------------------------------
  // Owners
  // ------------------------------------------------------------------

  async findOwners(
    query: AdminOwnersQueryDto,
  ): Promise<PaginatedResult<AdminOwnerResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.UserWhereInput = {
      memberships: { some: { role: 'OWNER', status: 'ACTIVE' } },
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          memberships: {
            where: { role: 'OWNER', status: 'ACTIVE' },
            include: {
              organization: {
                include: {
                  subscription: { select: { status: true } },
                  _count: { select: { properties: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((user) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        organizations: user.memberships.map((m) => ({
          organizationId: m.organization.id,
          organizationName: m.organization.name,
          propertyCount: m.organization._count.properties,
          subscriptionStatus: m.organization.subscription?.status ?? null,
        })),
      })),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOwnerDetail(userId: string): Promise<AdminOwnerResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        memberships: { some: { role: 'OWNER', status: 'ACTIVE' } },
      },
      include: {
        memberships: {
          where: { role: 'OWNER', status: 'ACTIVE' },
          include: {
            organization: {
              include: {
                subscription: { select: { status: true } },
                _count: { select: { properties: true } },
              },
            },
          },
        },
      },
    });
    if (!user) {
      throw new AppException(
        ErrorCode.OWNER_NOT_FOUND,
        'Owner not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      organizations: user.memberships.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        propertyCount: m.organization._count.properties,
        subscriptionStatus: m.organization.subscription?.status ?? null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Properties
  // ------------------------------------------------------------------

  async findProperties(
    query: AdminPropertiesQueryDto,
  ): Promise<PaginatedResult<AdminPropertyResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.PropertyWhereInput = {
      organizationId: query.organizationId,
      status: query.status,
      city: query.city
        ? { equals: query.city, mode: 'insensitive' }
        : undefined,
      state: query.state
        ? { equals: query.state, mode: 'insensitive' }
        : undefined,
    };

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          _count: { select: { rooms: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.property.count({ where }),
    ]);

    const bedCounts = await Promise.all(
      rows.map((p) =>
        this.prisma.bed.count({ where: { room: { propertyId: p.id } } }),
      ),
    );

    return {
      items: rows.map((property, index) => ({
        id: property.id,
        organizationId: property.organizationId,
        organizationName: property.organization.name,
        name: property.name,
        propertyType: property.propertyType,
        city: property.city,
        state: property.state,
        status: property.status,
        roomCount: property._count.rooms,
        bedCount: bedCounts[index],
        createdAt: property.createdAt,
      })),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findPropertyDetail(
    propertyId: string,
  ): Promise<AdminPropertyResponseDto> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        organization: { select: { name: true } },
        _count: { select: { rooms: true } },
      },
    });
    if (!property) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const bedCount = await this.prisma.bed.count({
      where: { room: { propertyId } },
    });

    return {
      id: property.id,
      organizationId: property.organizationId,
      organizationName: property.organization.name,
      name: property.name,
      propertyType: property.propertyType,
      city: property.city,
      state: property.state,
      status: property.status,
      roomCount: property._count.rooms,
      bedCount,
      createdAt: property.createdAt,
    };
  }

  // ------------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------------

  async findSubscriptions(
    query: AdminSubscriptionsQueryDto,
  ): Promise<PaginatedResult<AdminSubscriptionResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.OrganizationSubscriptionWhereInput = {
      status: query.status,
    };

    const [rows, total] = await Promise.all([
      this.prisma.organizationSubscription.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          saasPlan: { select: { name: true, price: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.organizationSubscription.count({ where }),
    ]);

    return {
      items: rows.map((sub) => ({
        id: sub.id,
        organizationId: sub.organizationId,
        organizationName: sub.organization.name,
        planName: sub.saasPlan.name,
        amount: sub.saasPlan.price.toString(),
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        nextBillingAt: sub.nextBillingAt,
        gracePeriodEndsAt: sub.gracePeriodEndsAt,
        lastPaymentStatus: null,
        outstandingInvoiceTotal: null,
      })),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findSubscriptionDetail(
    subscriptionId: string,
  ): Promise<AdminSubscriptionResponseDto> {
    const sub = await this.prisma.organizationSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        organization: { select: { name: true } },
        saasPlan: { select: { name: true, price: true } },
      },
    });
    if (!sub) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
        'Subscription not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const [lastPayment, outstandingAgg] = await Promise.all([
      this.prisma.subscriptionPayment.findFirst({
        where: { subscriptionId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      }),
      this.prisma.subscriptionInvoice.aggregate({
        where: { subscriptionId, status: { in: ['ISSUED', 'OVERDUE'] } },
        _sum: { total: true },
      }),
    ]);

    return {
      id: sub.id,
      organizationId: sub.organizationId,
      organizationName: sub.organization.name,
      planName: sub.saasPlan.name,
      amount: sub.saasPlan.price.toString(),
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      nextBillingAt: sub.nextBillingAt,
      gracePeriodEndsAt: sub.gracePeriodEndsAt,
      lastPaymentStatus: lastPayment?.status ?? null,
      outstandingInvoiceTotal: (
        outstandingAgg._sum.total ?? new Prisma.Decimal(0)
      ).toString(),
    };
  }

  private organizationNotFound(): AppException {
    return new AppException(
      ErrorCode.ORGANIZATION_NOT_FOUND,
      'Organization not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
