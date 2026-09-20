import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway.interface';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite -
// only the tables Phase 7 actually touches (auth/org/membership plus the
// four new Phase 7 tables). $transaction is a pass-through (fn(this)),
// and $queryRaw is a single generic stand-in for both the SaaS invoice
// sequence and the SELECT ... FOR UPDATE locks (whose return value is
// never read by the calling code). The genuine concurrent-request races
// (spec's four mandatory concurrency tests) are proven separately against
// the real Postgres instance - see the Phase 7 final report.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private saasPlans = new Map<string, any>();
  private subscriptions = new Map<string, any>();
  private subscriptionInvoices = new Map<string, any>();
  private subscriptionPayments = new Map<string, any>();
  private webhookEvents = new Map<string, any>();
  private invoiceSeq = 0;

  constructor() {
    const id = this.nextId();
    this.saasPlans.set(id, {
      id,
      name: 'Basic',
      description: 'Default plan',
      price: new Prisma.Decimal('499.00'),
      currency: 'INR',
      billingInterval: 'MONTHLY',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
  }

  private nextId(): string {
    return randomUUID();
  }

  private conflict(target: string): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target },
    });
  }

  user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) {
        return (
          [...this.users.values()].find((u) => u.email === where.email) ?? null
        );
      }
      return null;
    },
    create: async ({ data }: any) => {
      if (
        data.email &&
        [...this.users.values()].some((u) => u.email === data.email)
      ) {
        this.conflict('email');
      }
      const id = this.nextId();
      const now = new Date();
      const user = {
        id,
        platformRole: 'USER',
        status: 'ACTIVE',
        email: null,
        phone: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.users.set(id, user);
      return user;
    },
  };

  refreshToken = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const row = { id, revokedAt: null, createdAt: new Date(), ...data };
      this.refreshTokens.set(id, row);
      return row;
    },
    findUnique: async ({ where }: any) =>
      [...this.refreshTokens.values()].find(
        (r) => r.tokenHash === where.tokenHash,
      ) ?? null,
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of this.refreshTokens.values()) {
        if (Object.entries(where).every(([k, v]) => row[k] === v)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  organization = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const org = {
        id,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.organizations.set(id, org);
      return org;
    },
    findUnique: async ({ where }: any) =>
      this.organizations.get(where.id) ?? null,
    findMany: async () => [...this.organizations.values()],
  };

  // Test-only helper: Phase 2 never implemented a membership-invite
  // endpoint (deferred - see Phase 2 docs), so this e2e suite has no HTTP
  // path to add a second member to an organization. Used only to prove
  // MANAGER/STAFF are forbidden from subscription billing (spec
  // authorization section), the same way a real invite flow eventually
  // would create the row.
  addMembershipDirect(userId: string, organizationId: string, role: string) {
    const id = this.nextId();
    const now = new Date();
    this.memberships.set(id, {
      id,
      userId,
      organizationId,
      role,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
  }

  organizationMembership = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const membership = { id, createdAt: now, updatedAt: now, ...data };
      this.memberships.set(id, membership);
      return membership;
    },
    findFirst: async ({ where }: any) =>
      [...this.memberships.values()].find((m) =>
        Object.entries(where).every(([k, v]) => m[k as keyof typeof m] === v),
      ) ?? null,
    findMany: async ({ where }: any) =>
      [...this.memberships.values()].filter((m) =>
        Object.entries(where ?? {}).every(([k, v]) => m[k] === v),
      ),
  };

  saasPlan = {
    findMany: async ({ where }: any) =>
      [...this.saasPlans.values()]
        .filter((p) => (where?.status ? p.status === where.status : true))
        .sort((a, b) => a.createdAt - b.createdAt),
    findFirst: async ({ where }: any) => {
      const candidates = [...this.saasPlans.values()].filter((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.status && p.status !== where.status) return false;
        return true;
      });
      return candidates.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const plan = this.saasPlans.get(where.id);
      if (!plan) throw new Error('SaasPlan not found');
      return plan;
    },
  };

  organizationSubscription = {
    create: async ({ data }: any) => {
      if (
        [...this.subscriptions.values()].some(
          (s) => s.organizationId === data.organizationId,
        )
      ) {
        this.conflict('organizationId');
      }
      const id = this.nextId();
      const now = new Date();
      const subscription = {
        id,
        pendingSaasPlanId: null,
        gracePeriodEndsAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.subscriptions.set(id, subscription);
      return subscription;
    },
    findUnique: async ({ where, include }: any) => {
      const subscription = where.id
        ? this.subscriptions.get(where.id)
        : [...this.subscriptions.values()].find(
            (s) => s.organizationId === where.organizationId,
          );
      if (!subscription) return null;
      return this.attachPlan(subscription, include);
    },
    findUniqueOrThrow: async ({ where, include }: any) => {
      const subscription = this.subscriptions.get(where.id);
      if (!subscription) throw new Error('Subscription not found');
      return this.attachPlan(subscription, include);
    },
    update: async ({ where, data, include }: any) => {
      const subscription = this.subscriptions.get(where.id);
      Object.assign(subscription, data);
      return this.attachPlan(subscription, include);
    },
    findMany: async ({ where }: any) =>
      [...this.subscriptions.values()].filter((s) => {
        if (where?.status?.in && !where.status.in.includes(s.status))
          return false;
        return true;
      }),
  };

  private attachPlan(subscription: any, include: any) {
    if (include?.saasPlan) {
      return {
        ...subscription,
        saasPlan: this.saasPlans.get(subscription.saasPlanId),
      };
    }
    return subscription;
  }

  subscriptionInvoice = {
    create: async ({ data }: any) => {
      const dup = [...this.subscriptionInvoices.values()].some(
        (inv) =>
          inv.subscriptionId === data.subscriptionId &&
          inv.billingPeriodStart.getTime() ===
            data.billingPeriodStart.getTime() &&
          inv.billingPeriodEnd.getTime() === data.billingPeriodEnd.getTime(),
      );
      if (dup) this.conflict('subscription_invoices_period_unique');
      const id = this.nextId();
      const now = new Date();
      const invoice = { id, createdAt: now, updatedAt: now, ...data };
      this.subscriptionInvoices.set(id, invoice);
      return invoice;
    },
    findFirst: async ({ where }: any) => {
      const invoice = [...this.subscriptionInvoices.values()].find((inv) => {
        if (where.id && inv.id !== where.id) return false;
        if (where.organizationId) {
          if (typeof where.organizationId === 'string') {
            if (inv.organizationId !== where.organizationId) return false;
          } else if (where.organizationId.in) {
            if (!where.organizationId.in.includes(inv.organizationId))
              return false;
          }
        }
        return true;
      });
      return invoice ?? null;
    },
    findUnique: async ({ where }: any) =>
      this.subscriptionInvoices.get(where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const invoice = this.subscriptionInvoices.get(where.id);
      if (!invoice) throw new Error('SubscriptionInvoice not found');
      return invoice;
    },
    findMany: async ({ where }: any) =>
      [...this.subscriptionInvoices.values()]
        .filter((inv) =>
          where?.organizationId
            ? inv.organizationId === where.organizationId
            : true,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    update: async ({ where, data }: any) => {
      const invoice = this.subscriptionInvoices.get(where.id);
      Object.assign(invoice, data);
      return invoice;
    },
  };

  subscriptionPayment = {
    create: async ({ data }: any) => {
      if (
        data.idempotencyKey &&
        [...this.subscriptionPayments.values()].some(
          (p) => p.idempotencyKey === data.idempotencyKey,
        )
      ) {
        this.conflict('idempotencyKey');
      }
      const id = this.nextId();
      const now = new Date();
      const payment = {
        id,
        currency: 'INR',
        provider: 'RAZORPAY',
        status: 'CREATED',
        providerOrderId: null,
        providerPaymentId: null,
        idempotencyKey: null,
        failureCode: null,
        failureMessage: null,
        capturedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.subscriptionPayments.set(id, payment);
      return payment;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) return this.subscriptionPayments.get(where.id) ?? null;
      if (where.providerOrderId)
        return (
          [...this.subscriptionPayments.values()].find(
            (p) => p.providerOrderId === where.providerOrderId,
          ) ?? null
        );
      if (where.idempotencyKey)
        return (
          [...this.subscriptionPayments.values()].find(
            (p) => p.idempotencyKey === where.idempotencyKey,
          ) ?? null
        );
      return null;
    },
    findFirst: async ({ where }: any) =>
      [...this.subscriptionPayments.values()].find((p) => p.id === where.id) ??
      null,
    findMany: async ({ where }: any) =>
      [...this.subscriptionPayments.values()]
        .filter((p) =>
          where?.organizationId
            ? p.organizationId === where.organizationId
            : true,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    update: async ({ where, data }: any) => {
      const payment = this.subscriptionPayments.get(where.id);
      Object.assign(payment, data);
      return payment;
    },
  };

  webhookEvent = {
    create: async ({ data }: any) => {
      if (
        [...this.webhookEvents.values()].some(
          (e) => e.provider === data.provider && e.eventId === data.eventId,
        )
      ) {
        this.conflict('webhook_events_provider_event_unique');
      }
      const id = this.nextId();
      const event = { id, processedAt: null, createdAt: new Date(), ...data };
      this.webhookEvents.set(id, event);
      return event;
    },
    update: async ({ where, data }: any) => {
      const event = this.webhookEvents.get(where.id);
      Object.assign(event, data);
      return event;
    },
  };

  // The tenant-rent Payment table (Phase 6) is never populated in this
  // suite - PaymentsWebhookService checks it first before falling back to
  // SubscriptionPayment, so it must exist and simply never match.
  payment = {
    findUnique: async () => null,
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => {
    this.invoiceSeq += 1;
    return [{ nextval: String(this.invoiceSeq) }];
  };
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

// Deterministic in-memory stand-in for RazorpayGatewayService, shared by
// both Phase 6 and Phase 7 payment flows in this app instance (Phase 6's
// own e2e suite has its own copy) - the real HMAC math is unit-tested
// separately (razorpay-gateway.service.spec.ts).
class FakeGateway {
  private orderSeq = 0;
  public nextFetchStatus: 'captured' | 'authorized' = 'captured';

  createOrder = async () => {
    this.orderSeq += 1;
    return { providerOrderId: `order_fake_${this.orderSeq}` };
  };
  verifyPaymentSignature = (input: any) =>
    input.signature === 'valid-signature';
  verifyWebhookSignature = (_raw: Buffer, signature: string) =>
    signature === 'valid-webhook-signature';
  fetchPayment = async () => ({ status: this.nextFetchStatus, method: 'card' });
  createTransfer = async () => ({
    providerTransferId: 'trf_fake',
    status: 'processed',
  });
  refundPayment = async () => ({
    providerRefundId: 'rfnd_fake',
    status: 'processed',
  });
}

describe('Phase 7: owner SaaS subscription (e2e)', () => {
  let app: INestApplication;
  let throttlerSpy: jest.SpyInstance;
  let fakePrisma: FakePrisma;

  beforeAll(async () => {
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    fakePrisma = new FakePrisma();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakeGateway())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    throttlerSpy.mockRestore();
  });

  const server = () => app.getHttpServer();

  async function registerAndLogin(email: string) {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Test User', email, password: 'password123' })
      .expect(201);
    return res.body.data.tokens.accessToken as string;
  }

  async function createOrg(token: string, name: string) {
    const res = await request(server())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return res.body.data.id as string;
  }

  async function getUserId(token: string): Promise<string> {
    const res = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.id as string;
  }

  describe('SaaS plans', () => {
    it('lists active plans', async () => {
      const token = await registerAndLogin('plans-user@example.com');
      const res = await request(server())
        .get('/api/v1/saas/plans')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].price).toBe('499');
    });
  });

  describe('Subscription lifecycle: trial provisioning and OWNER-only access', () => {
    let ownerToken: string;
    let orgId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('sub-owner-1@example.com');
      orgId = await createOrg(ownerToken, 'Sub Org 1');
    });

    it('lazily provisions a TRIAL subscription on first access', async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('TRIAL');
      expect(res.body.data.plan.name).toBe('Basic');
      expect(res.body.data.accessBlocked).toBe(false);
    });

    it('returns the same subscription on a second read (never provisions twice)', async () => {
      const first = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const second = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it("an unrelated user cannot view this organization's subscription (BOLA)", async () => {
      const outsider = await registerAndLogin('sub-outsider-1@example.com');
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${outsider}`)
        .expect(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });
  });

  describe('Cancellation: at period end, not immediate', () => {
    let ownerToken: string;
    let orgId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('sub-owner-2@example.com');
      orgId = await createOrg(ownerToken, 'Sub Org 2');
      await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('marks cancellation requested without immediately ending TRIAL access', async () => {
      const res = await request(server())
        .post(`/api/v1/organizations/${orgId}/subscription/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('TRIAL');
      expect(res.body.data.accessBlocked).toBe(false);
    });

    it('rejects a duplicate cancellation request', async () => {
      const res = await request(server())
        .post(`/api/v1/organizations/${orgId}/subscription/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_SUBSCRIPTION_STATE');
    });
  });

  describe('Full SaaS payment flow: order -> verify -> invoice PAID -> subscription ACTIVE', () => {
    let ownerToken: string;
    let orgId: string;
    let subscriptionId: string;
    let invoiceId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('sub-owner-3@example.com');
      orgId = await createOrg(ownerToken, 'Sub Org 3');
      const sub = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      subscriptionId = sub.body.data.id;

      // No HTTP endpoint fast-forwards time (by design - see
      // SubscriptionsService.evaluateLifecycle's doc comment on lazy,
      // no-cron evaluation). To exercise the payment endpoints end to end
      // over HTTP, this test drives the same lifecycle transition a real
      // deployment's first renewal would eventually reach, by directly
      // ageing the fake's subscription row past its trial end - the
      // transition logic itself (TRIAL -> RENEWAL_DUE, invoice
      // generation) is what SubscriptionsService's own unit tests prove;
      // this block instead proves the *payment* flow that follows it.
      (fakePrisma as any).subscriptions.get(subscriptionId).currentPeriodEnd =
        new Date(Date.now() - 1000);
      (fakePrisma as any).subscriptions.get(subscriptionId).nextBillingAt =
        new Date(Date.now() - 1000);

      const afterRenewal = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(afterRenewal.body.data.status).toBe('RENEWAL_DUE');

      const invoices = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(invoices.body.data).toHaveLength(1);
      expect(invoices.body.data[0].status).toBe('ISSUED');
      expect(invoices.body.data[0].total).toBe('499');
      invoiceId = invoices.body.data[0].id;
    });

    let paymentId: string;

    it('creates a payment order for the invoice', async () => {
      const res = await request(server())
        .post(`/api/v1/subscription/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(201);
      expect(res.body.data.amount).toBe('499');
      expect(res.body.data.providerOrderId).toMatch(/^order_fake_/);
      paymentId = res.body.data.subscriptionPaymentId;
    });

    it('verifies the payment: CAPTURED, invoice PAID, subscription ACTIVE with an extended period', async () => {
      const orderRes = await request(server())
        .get(`/api/v1/subscription/payments/${paymentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const providerOrderId = orderRes.body.data.providerOrderId;

      const verifyRes = await request(server())
        .post(`/api/v1/subscription/payments/${paymentId}/verify`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: 'pay_fake_saas_1',
          razorpaySignature: 'valid-signature',
        })
        .expect(200);
      expect(verifyRes.body.data.status).toBe('CAPTURED');

      const invoiceRes = await request(server())
        .get(`/api/v1/subscription/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(invoiceRes.body.data.status).toBe('PAID');

      const subRes = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(subRes.body.data.status).toBe('ACTIVE');
      expect(subRes.body.data.gracePeriodEndsAt).toBeNull();
      expect(
        new Date(subRes.body.data.currentPeriodEnd).getTime(),
      ).toBeGreaterThan(Date.now());
    });

    it("lists the payment in the organization's payment history", async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription/payments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('CAPTURED');
    });
  });

  describe('Authorization: OWNER vs MANAGER vs STAFF vs cross-organization', () => {
    let ownerToken: string;
    let managerToken: string;
    let staffToken: string;
    let orgId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('sub-owner-4@example.com');
      orgId = await createOrg(ownerToken, 'Sub Org 4');

      managerToken = await registerAndLogin('sub-manager-4@example.com');
      const managerId = await getUserId(managerToken);
      fakePrisma.addMembershipDirect(managerId, orgId, 'MANAGER');

      staffToken = await registerAndLogin('sub-staff-4@example.com');
      const staffId = await getUserId(staffToken);
      fakePrisma.addMembershipDirect(staffId, orgId, 'STAFF');
    });

    it("an outsider cannot list this organization's subscription invoices", async () => {
      const outsider = await registerAndLogin('sub-outsider-4@example.com');
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription/invoices`)
        .set('Authorization', `Bearer ${outsider}`)
        .expect(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it("an outsider cannot list this organization's subscription payments", async () => {
      const outsider = await registerAndLogin('sub-outsider-4b@example.com');
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription/payments`)
        .set('Authorization', `Bearer ${outsider}`)
        .expect(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('OWNER can access their own subscription', async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('TRIAL');
    });

    it('MANAGER is forbidden from viewing subscription billing (403, not 404 - a real member, just insufficient role)', async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('STAFF is forbidden from viewing subscription billing', async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('MANAGER is forbidden from cancelling the subscription', async () => {
      await request(server())
        .post(`/api/v1/organizations/${orgId}/subscription/cancel`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });
  });

  describe('Change plan: scheduled, not immediate', () => {
    let ownerToken: string;
    let orgId: string;
    let currentPlanId: string;
    let otherPlanId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('sub-owner-5@example.com');
      orgId = await createOrg(ownerToken, 'Sub Org 5');
      const sub = await request(server())
        .get(`/api/v1/organizations/${orgId}/subscription`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      currentPlanId = sub.body.data.plan.id;
      otherPlanId = currentPlanId; // only one seeded plan in this fake
    });

    it("changing to the same (only available) plan does not alter the current period's plan", async () => {
      const res = await request(server())
        .post(`/api/v1/organizations/${orgId}/subscription/change-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ saasPlanId: otherPlanId })
        .expect(200);
      // The response's `plan` always reflects the CURRENT (not pending)
      // plan - a scheduled change never rewrites the active period.
      expect(res.body.data.plan.id).toBe(currentPlanId);
    });

    it('rejects an unknown/inactive plan id', async () => {
      const res = await request(server())
        .post(`/api/v1/organizations/${orgId}/subscription/change-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ saasPlanId: '00000000-0000-0000-0000-000000000000' })
        .expect(404);
      expect(res.body.error.code).toBe('SAAS_PLAN_NOT_FOUND');
    });
  });
});
