import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import {
  OccupancyMetricsDto,
  PlatformDashboardDto,
  PlatformOverviewDto,
  RevenueMetricsDto,
  TenantPaymentMetricsDto,
} from './dto/analytics-response.dto';

const ZERO = new Prisma.Decimal(0);

// Every metric here is a database-level aggregation (COUNT/SUM/GROUP BY),
// never "load every row and reduce it in Node" (spec's explicit
// performance requirement - this project's payments/subscriptions tables
// are exactly the kind of table that grows unboundedly over the
// platform's lifetime). No method here mutates anything - this is a
// pure read/reporting service.
@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: RevenueQueryDto): Promise<PlatformDashboardDto> {
    const [overview, revenue, occupancy, tenantPayments] = await Promise.all([
      this.getOverview(),
      this.getRevenueMetrics(query),
      this.getOccupancyMetrics(),
      this.getTenantPaymentMetrics(query),
    ]);
    return { overview, revenue, occupancy, tenantPayments };
  }

  async getOverview(): Promise<PlatformOverviewDto> {
    const [
      orgStatusCounts,
      trialOrgCount,
      activeSubOrgCount,
      totalProperties,
      activeProperties,
      archivedProperties,
      totalRooms,
      occupancy,
      totalTenants,
      activeResidents,
      checkedOutResidents,
      subStatusCounts,
    ] = await Promise.all([
      this.prisma.organization.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.organizationSubscription.count({
        where: { status: 'TRIAL' },
      }),
      this.prisma.organizationSubscription.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.property.count(),
      this.prisma.property.count({ where: { status: 'ACTIVE' } }),
      this.prisma.property.count({ where: { status: 'ARCHIVED' } }),
      this.prisma.room.count(),
      this.getOccupancyMetrics(),
      this.prisma.tenant.count(),
      this.prisma.residency.count({ where: { status: 'ACTIVE' } }),
      this.prisma.residency.count({ where: { status: 'CHECKED_OUT' } }),
      this.prisma.organizationSubscription.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const orgCount = (status: string) =>
      orgStatusCounts.find((r) => r.status === status)?._count._all ?? 0;
    const subCount = (status: string) =>
      subStatusCounts.find((r) => r.status === status)?._count._all ?? 0;

    return {
      totalOrganizations: orgStatusCounts.reduce(
        (sum, r) => sum + r._count._all,
        0,
      ),
      activeOrganizations: orgCount('ACTIVE'),
      inactiveOrganizations: orgCount('INACTIVE'),
      suspendedOrganizations: orgCount('SUSPENDED'),
      trialOrganizations: trialOrgCount,
      activeSubscriptionOrganizations: activeSubOrgCount,

      totalProperties,
      activeProperties,
      archivedProperties,

      totalRooms,
      totalBeds: occupancy.totalBeds,
      occupiedBeds: occupancy.occupiedBeds,
      availableBeds: occupancy.availableBeds,
      inactiveBeds: occupancy.inactiveBeds,
      occupancyPercentage: occupancy.occupancyPercentage,

      totalTenants,
      activeResidents,
      checkedOutResidents,

      activeSubscriptions: subCount('ACTIVE'),
      trialSubscriptions: subCount('TRIAL'),
      renewalDueSubscriptions: subCount('RENEWAL_DUE'),
      gracePeriodSubscriptions: subCount('GRACE_PERIOD'),
      suspendedSubscriptions: subCount('SUSPENDED'),
      cancelledSubscriptions: subCount('CANCELLED'),
    };
  }

  async getOccupancyMetrics(): Promise<OccupancyMetricsDto> {
    const [totalRooms, totalBeds, occupiedBeds, inactiveBeds] =
      await Promise.all([
        this.prisma.room.count(),
        this.prisma.bed.count(),
        this.prisma.bed.count({
          where: { allocations: { some: { status: 'ACTIVE' } } },
        }),
        this.prisma.bed.count({
          where: { status: { in: ['INACTIVE', 'ARCHIVED'] } },
        }),
      ]);
    const availableBeds = totalBeds - occupiedBeds - inactiveBeds;
    return {
      totalRooms,
      totalBeds,
      occupiedBeds,
      availableBeds: Math.max(availableBeds, 0),
      inactiveBeds,
      occupancyPercentage:
        totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
    };
  }

  // "SaaS Revenue Collected" is based only on CAPTURED SubscriptionPayment
  // rows (spec: never DRAFT invoices, unpaid invoices, failed, or
  // cancelled payments) - outstanding is a wholly separate figure, from
  // unpaid ISSUED/OVERDUE invoices, never derived from the collected
  // total.
  async getRevenueMetrics(query: RevenueQueryDto): Promise<RevenueMetricsDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const now = new Date();
    const currentMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const previousMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    const [
      collectedAgg,
      currentMonthAgg,
      previousMonthAgg,
      outstandingAgg,
      failedCount,
      activePayingOrgs,
      monthlyRows,
    ] = await Promise.all([
      this.prisma.subscriptionPayment.aggregate({
        where: {
          status: 'CAPTURED',
          capturedAt: from || to ? { gte: from, lte: to } : undefined,
        },
        _sum: { amount: true },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: { status: 'CAPTURED', capturedAt: { gte: currentMonthStart } },
        _sum: { amount: true },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: {
          status: 'CAPTURED',
          capturedAt: { gte: previousMonthStart, lt: currentMonthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.subscriptionInvoice.aggregate({
        where: { status: { in: ['ISSUED', 'OVERDUE'] } },
        _sum: { total: true },
      }),
      this.prisma.subscriptionPayment.count({ where: { status: 'FAILED' } }),
      this.prisma.subscriptionPayment
        .groupBy({ by: ['organizationId'], where: { status: 'CAPTURED' } })
        .then((rows) => rows.length),
      this.prisma.$queryRaw<{ month: Date; revenue: Prisma.Decimal }[]>`
        SELECT date_trunc('month', "capturedAt") AS month, SUM(amount) AS revenue
        FROM subscription_payments
        WHERE status = 'CAPTURED' AND "capturedAt" IS NOT NULL
        GROUP BY date_trunc('month', "capturedAt")
        ORDER BY month ASC
      `,
    ]);

    return {
      saasRevenueCollected: (collectedAgg._sum.amount ?? ZERO).toString(),
      currentMonthRevenue: (currentMonthAgg._sum.amount ?? ZERO).toString(),
      previousMonthRevenue: (previousMonthAgg._sum.amount ?? ZERO).toString(),
      outstandingSaasInvoices: (outstandingAgg._sum.total ?? ZERO).toString(),
      failedSubscriptionPayments: failedCount,
      activePayingOrganizations: activePayingOrgs,
      monthlyRevenue: monthlyRows.map((row) => ({
        month: row.month.toISOString().slice(0, 7),
        revenue: new Prisma.Decimal(row.revenue).toString(),
      })),
    };
  }

  // Explicitly "Tenant Rent Volume" - see this DTO's own doc comment for
  // why it must never be reported as "revenue."
  async getTenantPaymentMetrics(
    query: RevenueQueryDto,
  ): Promise<TenantPaymentMetricsDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const now = new Date();
    const currentMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [totalAgg, currentMonthAgg] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          status: 'CAPTURED',
          paidAt: from || to ? { gte: from, lte: to } : undefined,
        },
        _sum: { amount: true, platformFee: true, ownerSettlementAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'CAPTURED', paidAt: { gte: currentMonthStart } },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalTenantRentVolume: (totalAgg._sum.amount ?? ZERO).toString(),
      currentMonthTenantRentVolume: (
        currentMonthAgg._sum.amount ?? ZERO
      ).toString(),
      platformFeesCollected: (totalAgg._sum.platformFee ?? ZERO).toString(),
      ownerSettlementAmount: (
        totalAgg._sum.ownerSettlementAmount ?? ZERO
      ).toString(),
    };
  }
}
