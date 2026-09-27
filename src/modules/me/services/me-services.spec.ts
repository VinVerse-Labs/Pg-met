import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MyBillingService } from './my-billing.service';
import { MyStayService } from './my-stay.service';

const D = (v: string) => new Prisma.Decimal(v);

const tenantUser: AuthenticatedUser = {
  id: 'user-tenant',
  name: 'Priya',
  email: 'priya@example.com',
  phone: null,
  status: 'ACTIVE',
  platformRole: 'USER',
};

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    residencyId: 'res-1',
    rentPlanId: null,
    invoiceNumber: 'INV-2026-000001',
    billingPeriodStart: new Date('2026-09-01'),
    billingPeriodEnd: new Date('2026-09-30'),
    issueDate: new Date('2026-09-01'),
    dueDate: new Date('2026-09-05'),
    subtotal: D('1000.30'),
    discount: D('0'),
    tax: D('0'),
    total: D('1000.30'),
    currency: 'INR',
    status: 'PARTIALLY_PAID',
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    residency: { property: { name: 'Sunrise PG' } },
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    residencyId: 'res-1',
    invoiceId: 'inv-1',
    payerUserId: 'user-tenant',
    amount: D('500.10'),
    currency: 'INR',
    platformFee: D('5.00'),
    ownerSettlementAmount: D('495.10'),
    method: 'upi',
    status: 'CAPTURED',
    provider: 'RAZORPAY',
    providerOrderId: 'order_1',
    providerPaymentId: 'pay_rzp_1',
    idempotencyKey: 'k',
    failureCode: null,
    failureMessage: null,
    paidAt: new Date('2026-09-02'),
    createdAt: new Date('2026-09-02'),
    updatedAt: new Date('2026-09-02'),
    invoice: { invoiceNumber: 'INV-2026-000001' },
    ...overrides,
  };
}

describe('MyBillingService', () => {
  let prisma: any;
  let service: MyBillingService;

  beforeEach(() => {
    prisma = {
      invoice: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
      payment: { findMany: jest.fn(), count: jest.fn() },
      paymentAllocation: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    service = new MyBillingService(prisma);
  });

  it('scopes invoices to the caller and never returns DRAFT', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);
    await service.listInvoices(tenantUser, { page: 1, limit: 20 });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          residency: { tenant: { userId: 'user-tenant' } },
          status: { not: 'DRAFT' },
        },
      }),
    );
  });

  it('returns nothing for an explicit DRAFT filter', async () => {
    const result = await service.listInvoices(tenantUser, {
      page: 1,
      limit: 20,
      status: 'DRAFT',
    });
    expect(result.items).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it('computes amountPaid/balanceDue exactly in decimal (no float drift)', async () => {
    prisma.invoice.findMany.mockResolvedValue([invoiceRow()]);
    prisma.invoice.count.mockResolvedValue(1);
    prisma.paymentAllocation.groupBy.mockResolvedValue([
      { invoiceId: 'inv-1', _sum: { amount: D('500.10') } },
    ]);
    const { items } = await service.listInvoices(tenantUser, {
      page: 1,
      limit: 20,
    });
    expect(items[0]).toMatchObject({
      total: '1000.30',
      amountPaid: '500.10',
      balanceDue: '500.20',
      isPayable: true,
      propertyName: 'Sunrise PG',
    });
  });

  it('is not payable once fully allocated, or when VOID/PAID', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      invoiceRow({ id: 'a', status: 'PARTIALLY_PAID' }),
      invoiceRow({ id: 'b', status: 'VOID' }),
      invoiceRow({ id: 'c', status: 'PAID' }),
    ]);
    prisma.invoice.count.mockResolvedValue(3);
    prisma.paymentAllocation.groupBy.mockResolvedValue([
      { invoiceId: 'a', _sum: { amount: D('1000.30') } },
    ]);
    const { items } = await service.listInvoices(tenantUser, {
      page: 1,
      limit: 20,
    });
    expect(items.map((i) => i.isPayable)).toEqual([false, false, false]);
    expect(items[0].balanceDue).toBe('0.00');
  });

  it("404s another tenant's invoice (query is caller-scoped)", async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(
      service.getInvoice(tenantUser, 'someone-elses'),
    ).rejects.toMatchObject({ code: ErrorCode.INVOICE_NOT_FOUND });
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'someone-elses',
          residency: { tenant: { userId: 'user-tenant' } },
          status: { not: 'DRAFT' },
        },
      }),
    );
  });

  it('invoice detail includes items and tenant-safe payments only', async () => {
    prisma.invoice.findFirst.mockResolvedValue(
      invoiceRow({
        items: [
          {
            id: 'item-1',
            invoiceId: 'inv-1',
            description: 'Rent - September',
            itemType: 'RENT',
            quantity: 1,
            unitAmount: D('1000.30'),
            amount: D('1000.30'),
          },
        ],
        payments: [paymentRow()],
      }),
    );
    const detail = await service.getInvoice(tenantUser, 'inv-1');
    expect(detail.items[0]).toMatchObject({
      unitAmount: '1000.30',
      amount: '1000.30',
    });
    const payment = detail.payments[0] as unknown as Record<string, unknown>;
    expect(payment).toMatchObject({
      amount: '500.10',
      providerPaymentId: 'pay_rzp_1',
    });
    for (const hidden of [
      'platformFee',
      'ownerSettlementAmount',
      'settlement',
      'organizationId',
      'idempotencyKey',
      'providerOrderId',
    ]) {
      expect(payment).not.toHaveProperty(hidden);
    }
  });

  it('summarises outstanding per currency with the earliest-due payable invoice next', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      invoiceRow({
        id: 'late',
        dueDate: new Date('2026-08-05'),
        status: 'OVERDUE',
        total: D('0.10'),
      }),
      invoiceRow({
        id: 'now',
        dueDate: new Date('2026-09-05'),
        status: 'ISSUED',
        total: D('0.20'),
      }),
    ]);
    const summary = await service.getRentSummary(tenantUser);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          residency: { tenant: { userId: 'user-tenant' } },
          status: { in: ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'] },
        },
      }),
    );
    expect(summary.outstanding).toEqual([{ currency: 'INR', amount: '0.30' }]);
    expect(summary.openInvoiceCount).toBe(2);
    expect(summary.overdueInvoiceCount).toBe(1);
    expect(summary.nextDue?.id).toBe('late');
  });

  it('an empty summary when nothing is owed', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    const summary = await service.getRentSummary(tenantUser);
    expect(summary).toMatchObject({
      outstanding: [],
      openInvoiceCount: 0,
      nextDue: null,
    });
  });

  it('lists only payments the caller made', async () => {
    prisma.payment.findMany.mockResolvedValue([paymentRow()]);
    prisma.payment.count.mockResolvedValue(1);
    const result = await service.listPayments(tenantUser, {
      page: 1,
      limit: 20,
    });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { payerUserId: 'user-tenant' } }),
    );
    expect(result.items[0]).not.toHaveProperty('platformFee');
  });
});

describe('MyStayService', () => {
  let prisma: any;
  let service: MyStayService;

  const residency = (overrides: Record<string, unknown> = {}) => ({
    id: 'res-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    startDate: new Date('2026-08-01'),
    expectedEndDate: null,
    actualEndDate: null,
    status: 'ACTIVE',
    property: {
      id: 'prop-1',
      name: 'Sunrise PG',
      propertyType: 'PG',
      addressLine1: '12 MG Road',
      addressLine2: null,
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
    },
    allocations: [
      {
        startDate: new Date('2026-08-01'),
        bed: {
          bedNumber: 'A',
          berth: 'LOWER',
          room: { roomNumber: '204', floor: 2, roomType: 'DOUBLE' },
        },
      },
    ],
    rentPlans: [
      {
        amount: D('8500.00'),
        currency: 'INR',
        billingCycle: 'MONTHLY',
        dueDay: 5,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      residency: { findFirst: jest.fn() },
    };
    service = new MyStayService(prisma);
  });

  it('returns null (not an error) when the caller has no tenant profile', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.findCurrent(tenantUser)).resolves.toBeNull();
    expect(prisma.residency.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the tenant from the caller and prefers a current stay', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.residency.findFirst.mockResolvedValueOnce(residency());
    const stay = await service.findCurrent(tenantUser);
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-tenant' } }),
    );
    expect(prisma.residency.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.residency.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
    });
    expect(stay).toMatchObject({
      status: 'ACTIVE',
      property: { name: 'Sunrise PG' },
      room: { roomNumber: '204', floor: 2, roomType: 'DOUBLE' },
      bed: { bedNumber: 'A', berth: 'LOWER' },
      rent: { amount: '8500.00', dueDay: 5 },
    });
  });

  it('falls back to an upcoming PENDING stay with no room/bed yet', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.residency.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        residency({ status: 'PENDING', allocations: [], rentPlans: [] }),
      );
    const stay = await service.findCurrent(tenantUser);
    expect(prisma.residency.findFirst.mock.calls[1][0].where).toEqual({
      tenantId: 'tenant-1',
      status: 'PENDING',
    });
    expect(stay).toMatchObject({
      status: 'PENDING',
      room: null,
      bed: null,
      rent: null,
    });
  });

  it('returns null when the tenant has only checked-out stays', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.residency.findFirst.mockResolvedValue(null);
    await expect(service.findCurrent(tenantUser)).resolves.toBeNull();
  });
});
