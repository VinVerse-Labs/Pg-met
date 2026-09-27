import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { MeBillingController } from '../src/modules/me/controllers/me-billing.controller';
import { MyBillingService } from '../src/modules/me/services/my-billing.service';
import { MyStayService } from '../src/modules/me/services/my-stay.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../src/database/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AppException } from '../src/common/exceptions/app.exception';
import { ErrorCode } from '../src/common/constants/error-code.enum';

// HTTP-level coverage for the Phase 13 tenant self-service reads
// (/me/residency, /me/rent, /me/invoices, /me/payments): real controller,
// services, ValidationPipe (same config as AppModule), response envelope and
// exception filter; JwtAuthGuard swapped for a header-based stand-in (the
// real JWT path is covered by auth.e2e-spec) and Prisma for a small
// in-memory fake that honours exactly the queries these services make -
// including the caller scoping, so cross-tenant isolation is exercised
// end-to-end rather than only asserted on mock call arguments.

const D = (v: string) => new Prisma.Decimal(v);

const USERS: Record<string, { id: string; platformRole: 'USER' }> = {
  alice: { id: 'user-alice', platformRole: 'USER' },
  bob: { id: 'user-bob', platformRole: 'USER' },
  nobody: { id: 'user-nobody', platformRole: 'USER' },
};

class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = USERS[req.headers['x-test-user'] as string];
    if (!user) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    req.user = {
      ...user,
      name: user.id,
      email: null,
      phone: null,
      status: 'ACTIVE',
    };
    return true;
  }
}

const property = {
  id: 'prop-1',
  name: 'Sunrise PG',
  propertyType: 'PG',
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Hyderabad',
  state: 'Telangana',
  postalCode: '500001',
  timezone: 'Asia/Kolkata',
};

function buildFakePrisma() {
  const tenants = [
    { id: 'tenant-alice', userId: 'user-alice' },
    { id: 'tenant-bob', userId: 'user-bob' },
  ];
  const residencies = [
    {
      id: 'res-alice',
      tenantId: 'tenant-alice',
      status: 'ACTIVE',
      startDate: new Date('2026-08-01'),
      expectedEndDate: null,
      property,
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
          amount: D('8500'),
          currency: 'INR',
          billingCycle: 'MONTHLY',
          dueDay: 5,
        },
      ],
    },
    {
      id: 'res-bob',
      tenantId: 'tenant-bob',
      status: 'ACTIVE',
      startDate: new Date('2026-07-01'),
      expectedEndDate: null,
      property,
      allocations: [],
      rentPlans: [],
    },
  ];
  const userOfResidency = (rid: string) =>
    tenants.find(
      (t) => t.id === residencies.find((r) => r.id === rid)?.tenantId,
    )?.userId;
  const invoice = (
    id: string,
    residencyId: string,
    status: string,
    total: string,
    due: string,
  ) => ({
    id,
    residencyId,
    rentPlanId: null,
    invoiceNumber: `INV-${id}`,
    billingPeriodStart: new Date(due),
    billingPeriodEnd: new Date(due),
    issueDate: status === 'DRAFT' ? null : new Date(due),
    dueDate: new Date(due),
    subtotal: D(total),
    discount: D('0'),
    tax: D('0'),
    total: D(total),
    currency: 'INR',
    status,
    createdAt: new Date(due),
    updatedAt: new Date(due),
  });
  const invoices = [
    invoice('a-sep', 'res-alice', 'PARTIALLY_PAID', '8500', '2026-09-05'),
    invoice('a-oct', 'res-alice', 'DRAFT', '8500', '2026-10-05'),
    invoice('b-sep', 'res-bob', 'ISSUED', '7000', '2026-09-05'),
  ];
  const allocations = [{ invoiceId: 'a-sep', amount: D('4000') }];
  const payments = [
    {
      id: 'pay-a1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      residencyId: 'res-alice',
      invoiceId: 'a-sep',
      payerUserId: 'user-alice',
      amount: D('4000'),
      currency: 'INR',
      platformFee: D('40'),
      ownerSettlementAmount: D('3960'),
      method: 'upi',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_rzp_1',
      idempotencyKey: null,
      failureCode: null,
      failureMessage: null,
      paidAt: new Date('2026-09-02'),
      createdAt: new Date('2026-09-02'),
      updatedAt: new Date('2026-09-02'),
    },
  ];

  const matchesInvoice = (inv: any, where: any = {}) => {
    if (where.id && inv.id !== where.id) return false;
    const userId = where.residency?.tenant?.userId;
    if (userId && userOfResidency(inv.residencyId) !== userId) return false;
    const s = where.status;
    if (typeof s === 'string' && inv.status !== s) return false;
    if (s?.not && inv.status === s.not) return false;
    if (s?.in && !s.in.includes(inv.status)) return false;
    return true;
  };
  const withIncludes = (inv: any) => ({
    ...inv,
    residency: { property: { name: property.name } },
    items: [
      {
        id: `item-${inv.id}`,
        invoiceId: inv.id,
        description: 'Monthly rent',
        itemType: 'RENT',
        quantity: 1,
        unitAmount: inv.total,
        amount: inv.total,
        createdAt: inv.createdAt,
      },
    ],
  });

  return {
    tenant: {
      findUnique: async ({ where }: any) =>
        tenants.find((t) => t.userId === where.userId) ?? null,
    },
    residency: {
      findFirst: async ({ where }: any) => {
        const statuses = where.status?.in ?? [where.status];
        return (
          residencies.find(
            (r) => r.tenantId === where.tenantId && statuses.includes(r.status),
          ) ?? null
        );
      },
    },
    invoice: {
      findMany: async ({ where, skip = 0, take }: any) =>
        invoices
          .filter((i) => matchesInvoice(i, where))
          .slice(skip, take ? skip + take : undefined)
          .map(withIncludes),
      count: async ({ where }: any) =>
        invoices.filter((i) => matchesInvoice(i, where)).length,
      findFirst: async ({ where, include }: any) => {
        const found = invoices.find((i) => matchesInvoice(i, where));
        if (!found) return null;
        const row = withIncludes(found);
        const payerUserId = include?.payments?.where?.payerUserId;
        return {
          ...row,
          payments: payments
            .filter(
              (p) => p.invoiceId === found.id && p.payerUserId === payerUserId,
            )
            .map((p) => ({
              ...p,
              invoice: { invoiceNumber: found.invoiceNumber },
            })),
        };
      },
    },
    payment: {
      findMany: async ({ where }: any) =>
        payments
          .filter((p) => p.payerUserId === where.payerUserId)
          .map((p) => ({
            ...p,
            invoice: {
              invoiceNumber: invoices.find((i) => i.id === p.invoiceId)!
                .invoiceNumber,
            },
          })),
      count: async ({ where }: any) =>
        payments.filter((p) => p.payerUserId === where.payerUserId).length,
    },
    paymentAllocation: {
      groupBy: async ({ where }: any) => {
        const ids: string[] = where.invoiceId.in;
        return ids
          .map((invoiceId) => {
            const rows = allocations.filter((a) => a.invoiceId === invoiceId);
            if (rows.length === 0) return null;
            return {
              invoiceId,
              _sum: {
                amount: rows.reduce((sum, a) => sum.plus(a.amount), D('0')),
              },
            };
          })
          .filter(Boolean);
      },
    },
  };
}

describe('Phase 13 - tenant self-service reads (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MeBillingController],
      providers: [
        MyStayService,
        MyBillingService,
        { provide: PrismaService, useValue: buildFakePrisma() },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Same ValidationPipe configuration as AppModule's APP_PIPE.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) =>
          new AppException(
            ErrorCode.VALIDATION_FAILED,
            'Validation failed',
            HttpStatus.BAD_REQUEST,
            errors.map((e) => ({
              field: e.property,
              constraints: e.constraints,
            })),
          ),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, user?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return user ? req.set('x-test-user', user) : req;
  };

  it.each([
    '/me/residency',
    '/me/rent',
    '/me/invoices',
    '/me/invoices/a-sep',
    '/me/payments',
  ])('401s %s without authentication', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /me/residency returns the caller's own stay", async () => {
    const res = await get('/me/residency', 'alice').expect(200);
    expect(res.body.data).toMatchObject({
      residencyId: 'res-alice',
      status: 'ACTIVE',
      property: { name: 'Sunrise PG' },
      room: { roomNumber: '204' },
      bed: { bedNumber: 'A', berth: 'LOWER' },
      rent: { amount: '8500.00', currency: 'INR', dueDay: 5 },
    });
  });

  it('GET /me/residency is a successful null for a user with no tenant profile', async () => {
    const res = await get('/me/residency', 'nobody').expect(200);
    expect(res.body).toMatchObject({ success: true, data: null });
  });

  it('GET /me/invoices lists only the caller’s non-draft invoices with server-computed balances', async () => {
    const res = await get('/me/invoices', 'alice').expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      id: 'a-sep',
      total: '8500.00',
      amountPaid: '4000.00',
      balanceDue: '4500.00',
      isPayable: true,
    });
  });

  it('rejects unknown query parameters (forbidNonWhitelisted) and out-of-range pagination', async () => {
    await get('/me/invoices?tenantId=tenant-bob', 'alice').expect(400);
    await get('/me/invoices?limit=500', 'alice').expect(400);
    await get('/me/invoices?status=NOPE', 'alice').expect(400);
  });

  it("GET /me/invoices/:id 404s another tenant's invoice and a draft", async () => {
    const other = await get('/me/invoices/b-sep', 'alice').expect(404);
    expect(other.body.error.code).toBe('INVOICE_NOT_FOUND');
    await get('/me/invoices/a-oct', 'alice').expect(404);
  });

  it('GET /me/invoices/:id returns items and tenant-safe payments', async () => {
    const res = await get('/me/invoices/a-sep', 'alice').expect(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.payments[0]).toMatchObject({
      id: 'pay-a1',
      amount: '4000.00',
      status: 'CAPTURED',
    });
    expect(res.body.data.payments[0]).not.toHaveProperty('platformFee');
    expect(res.body.data.payments[0]).not.toHaveProperty(
      'ownerSettlementAmount',
    );
  });

  it('GET /me/rent summarises what the caller owes', async () => {
    const alice = await get('/me/rent', 'alice').expect(200);
    expect(alice.body.data).toMatchObject({
      outstanding: [{ currency: 'INR', amount: '4500.00' }],
      openInvoiceCount: 1,
      overdueInvoiceCount: 0,
      nextDue: { id: 'a-sep' },
    });
    const bob = await get('/me/rent', 'bob').expect(200);
    expect(bob.body.data.outstanding).toEqual([
      { currency: 'INR', amount: '7000.00' },
    ]);
  });

  it("GET /me/payments never includes another user's payments", async () => {
    const alice = await get('/me/payments', 'alice').expect(200);
    expect(alice.body.data.items.map((p: { id: string }) => p.id)).toEqual([
      'pay-a1',
    ]);
    const bob = await get('/me/payments', 'bob').expect(200);
    expect(bob.body.data.items).toEqual([]);
  });
});
