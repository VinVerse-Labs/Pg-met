import { Prisma } from '@prisma/client';
import { PlatformAnalyticsService } from './platform-analytics.service';

describe('PlatformAnalyticsService', () => {
  let service: PlatformAnalyticsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      organization: { groupBy: jest.fn() },
      organizationSubscription: { count: jest.fn(), groupBy: jest.fn() },
      property: { count: jest.fn() },
      room: { count: jest.fn() },
      bed: { count: jest.fn() },
      tenant: { count: jest.fn() },
      residency: { count: jest.fn() },
      subscriptionPayment: {
        aggregate: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      subscriptionInvoice: { aggregate: jest.fn() },
      payment: { aggregate: jest.fn() },
      $queryRaw: jest.fn(),
    };
    service = new PlatformAnalyticsService(prisma);
  });

  describe('getOccupancyMetrics', () => {
    it('computes availableBeds as totalBeds - occupied - inactive, never negative', async () => {
      prisma.room.count.mockResolvedValue(10);
      prisma.bed.count
        .mockResolvedValueOnce(20) // totalBeds
        .mockResolvedValueOnce(12) // occupiedBeds
        .mockResolvedValueOnce(3); // inactiveBeds

      const result = await service.getOccupancyMetrics();

      expect(result).toMatchObject({
        totalRooms: 10,
        totalBeds: 20,
        occupiedBeds: 12,
        inactiveBeds: 3,
        availableBeds: 5,
        occupancyPercentage: 60,
      });
    });

    it('reports zero occupancy percentage when there are no beds at all', async () => {
      prisma.room.count.mockResolvedValue(0);
      prisma.bed.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.getOccupancyMetrics();
      expect(result.occupancyPercentage).toBe(0);
    });
  });

  describe('getRevenueMetrics', () => {
    it('only counts CAPTURED subscription payments as collected revenue', async () => {
      prisma.subscriptionPayment.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('998.00') },
        }) // collected
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('499.00') },
        }) // current month
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0') } }); // previous month
      prisma.subscriptionInvoice.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal('499.00') },
      });
      prisma.subscriptionPayment.count.mockResolvedValue(2);
      prisma.subscriptionPayment.groupBy.mockResolvedValue([
        { organizationId: 'org-1' },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        {
          month: new Date('2026-09-01'),
          revenue: new Prisma.Decimal('998.00'),
        },
      ]);

      const result = await service.getRevenueMetrics({});

      expect(result.saasRevenueCollected).toBe('998');
      expect(result.outstandingSaasInvoices).toBe('499');
      expect(result.failedSubscriptionPayments).toBe(2);
      expect(result.activePayingOrganizations).toBe(1);
      expect(result.monthlyRevenue).toEqual([
        { month: '2026-09', revenue: '998' },
      ]);
      // Every aggregate call that computes "collected" money must filter
      // on status: 'CAPTURED' - never DRAFT/unpaid/failed/cancelled.
      expect(
        prisma.subscriptionPayment.aggregate.mock.calls[0][0].where.status,
      ).toBe('CAPTURED');
    });

    it('returns zero, not null/undefined, when there is no data yet', async () => {
      prisma.subscriptionPayment.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      prisma.subscriptionInvoice.aggregate.mockResolvedValue({
        _sum: { total: null },
      });
      prisma.subscriptionPayment.count.mockResolvedValue(0);
      prisma.subscriptionPayment.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getRevenueMetrics({});
      expect(result.saasRevenueCollected).toBe('0');
      expect(result.outstandingSaasInvoices).toBe('0');
    });
  });

  describe('getTenantPaymentMetrics', () => {
    it('labels tenant rent figures separately from platform fee/settlement figures', async () => {
      prisma.payment.aggregate
        .mockResolvedValueOnce({
          _sum: {
            amount: new Prisma.Decimal('13000.00'),
            platformFee: new Prisma.Decimal('3.00'),
            ownerSettlementAmount: new Prisma.Decimal('12997.00'),
          },
        })
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('13000.00') },
        });

      const result = await service.getTenantPaymentMetrics({});

      expect(result.totalTenantRentVolume).toBe('13000');
      expect(result.platformFeesCollected).toBe('3');
      expect(result.ownerSettlementAmount).toBe('12997');
      expect(prisma.payment.aggregate.mock.calls[0][0].where.status).toBe(
        'CAPTURED',
      );
    });
  });
});
