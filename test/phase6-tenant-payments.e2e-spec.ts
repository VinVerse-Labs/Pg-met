import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway.interface';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite,
// extended through Phase 6: payments, payment_allocations,
// platform_fee_rules, owner_payment_accounts, owner_settlements, refunds,
// webhook_events. Enforces the same invariants the real migration does
// (payment_allocations_payment_invoice_unique, webhook_events unique
// (provider, eventId)) for sequential requests - the genuine concurrent
// race (spec section 44) is proven separately against the real Postgres
// instance, see the Phase 6 final report.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private properties = new Map<string, any>();
  private rooms = new Map<string, any>();
  private beds = new Map<string, any>();
  private tenants = new Map<string, any>();
  private residencies = new Map<string, any>();
  private bedAllocations = new Map<string, any>();
  private rentPlans = new Map<string, any>();
  private invoices = new Map<string, any>();
  private invoiceItems = new Map<string, any>();
  private invoiceSeq = 0;
  private payments = new Map<string, any>();
  private paymentAllocations = new Map<string, any>();
  private platformFeeRules = new Map<string, any>();
  private ownerPaymentAccounts = new Map<string, any>();
  private ownerSettlements = new Map<string, any>();
  private refunds = new Map<string, any>();
  private webhookEvents = new Map<string, any>();

  constructor() {
    const id = this.nextId();
    this.platformFeeRules.set(id, {
      id,
      feeType: 'FIXED',
      amount: new Prisma.Decimal('1.00'),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
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

  private matchesOrgFilter(property: any, orgFilter: any): boolean {
    if (!orgFilter) return true;
    if (!property) return false;
    if (typeof orgFilter === 'string')
      return property.organizationId === orgFilter;
    if (orgFilter.in) return orgFilter.in.includes(property.organizationId);
    return false;
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

  property = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const property = {
        id,
        propertyType: 'PG',
        status: 'ACTIVE',
        addressLine2: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.properties.set(id, property);
      return property;
    },
    findUnique: async ({ where }: any) => this.properties.get(where.id) ?? null,
    findFirst: async ({ where }: any) =>
      [...this.properties.values()].find((p) => {
        if (p.id !== where.id) return false;
        return this.matchesOrgFilter(p, where.organizationId);
      }) ?? null,
    update: async ({ where, data }: any) => {
      const property = this.properties.get(where.id);
      Object.assign(property, data);
      return property;
    },
  };

  room = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const room = {
        id,
        floor: null,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.rooms.set(id, room);
      return room;
    },
    findFirst: async ({ where, include }: any) => {
      const room = [...this.rooms.values()].find((r) => {
        if (r.id !== where.id) return false;
        if (where.propertyId && r.propertyId !== where.propertyId) return false;
        if (where.property) {
          const property = this.properties.get(r.propertyId);
          if (!this.matchesOrgFilter(property, where.property.organizationId))
            return false;
        }
        return true;
      });
      if (!room) return null;
      if (include?.property) {
        return { ...room, property: this.properties.get(room.propertyId) };
      }
      return room;
    },
  };

  bed = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const bed = {
        id,
        status: 'AVAILABLE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.beds.set(id, bed);
      return bed;
    },
    count: async ({ where }: any) =>
      [...this.beds.values()].filter((b) => {
        if (b.roomId !== where.roomId) return false;
        if (where.status?.not) return b.status !== where.status.not;
        return true;
      }).length,
    findFirst: async ({ where, include }: any) => {
      const bed = [...this.beds.values()].find((b) => {
        if (b.id !== where.id) return false;
        if (where.roomId && b.roomId !== where.roomId) return false;
        if (where.room?.propertyId) {
          const room = this.rooms.get(b.roomId);
          if (!room || room.propertyId !== where.room.propertyId) return false;
        }
        return true;
      });
      if (!bed) return null;
      if (include?.room) {
        const room = this.rooms.get(bed.roomId);
        const property = include.room.include?.property
          ? this.properties.get(room.propertyId)
          : undefined;
        return { ...bed, room: property ? { ...room, property } : room };
      }
      return bed;
    },
    update: async ({ where, data }: any) => {
      const bed = this.beds.get(where.id);
      Object.assign(bed, data);
      return bed;
    },
  };

  tenant = {
    create: async ({ data }: any) => {
      if ([...this.tenants.values()].some((t) => t.userId === data.userId)) {
        this.conflict('userId');
      }
      const id = this.nextId();
      const now = new Date();
      const tenant = { id, createdAt: now, updatedAt: now, ...data };
      this.tenants.set(id, tenant);
      return tenant;
    },
    findUnique: async ({ where }: any) => this.tenants.get(where.id) ?? null,
  };

  residency = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const residency = {
        id,
        status: 'PENDING',
        expectedEndDate: null,
        actualEndDate: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.residencies.set(id, residency);
      return residency;
    },
    findFirst: async ({ where, include }: any) => {
      const residency = [...this.residencies.values()].find((r) => {
        if (where.id && r.id !== where.id) return false;
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.status?.in && !where.status.in.includes(r.status))
          return false;
        if (where.property) {
          const property = this.properties.get(r.propertyId);
          if (!this.matchesOrgFilter(property, where.property.organizationId))
            return false;
        }
        return true;
      });
      if (!residency) return null;
      if (include?.property) {
        return {
          ...residency,
          property: this.properties.get(residency.propertyId),
        };
      }
      return residency;
    },
    update: async ({ where, data }: any) => {
      const residency = this.residencies.get(where.id);
      Object.assign(residency, data);
      return residency;
    },
  };

  bedAllocation = {
    create: async ({ data }: any) => {
      const status = data.status ?? 'ACTIVE';
      if (status === 'ACTIVE') {
        const conflicting = [...this.bedAllocations.values()].some(
          (a) => a.bedId === data.bedId && a.status === 'ACTIVE',
        );
        if (conflicting) this.conflict('bed_allocations_active_bed_unique');
      }
      const id = this.nextId();
      const now = new Date();
      const allocation = {
        id,
        status,
        endDate: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.bedAllocations.set(id, allocation);
      return allocation;
    },
    findFirst: async ({ where }: any) =>
      [...this.bedAllocations.values()].find((a) =>
        Object.entries(where).every(([k, v]) => a[k] === v),
      ) ?? null,
    update: async ({ where, data }: any) => {
      const allocation = this.bedAllocations.get(where.id);
      Object.assign(allocation, data);
      return allocation;
    },
  };

  rentPlan = {
    create: async ({ data }: any) => {
      if (
        [...this.rentPlans.values()].some(
          (p) => p.residencyId === data.residencyId && p.status === 'ACTIVE',
        )
      ) {
        this.conflict('rent_plans_active_residency_unique');
      }
      const id = this.nextId();
      const now = new Date();
      const plan = {
        id,
        currency: 'INR',
        billingCycle: 'MONTHLY',
        effectiveTo: null,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.rentPlans.set(id, plan);
      return plan;
    },
    findFirst: async ({ where, include, orderBy }: any) => {
      let candidates = [...this.rentPlans.values()].filter((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.residencyId && p.residencyId !== where.residencyId)
          return false;
        if (where.status && p.status !== where.status) return false;
        if (
          where.effectiveFrom?.lte &&
          !(p.effectiveFrom <= where.effectiveFrom.lte)
        ) {
          return false;
        }
        if (where.OR) {
          const matchesOr = where.OR.some((clause: any) => {
            if ('effectiveTo' in clause && clause.effectiveTo === null) {
              return p.effectiveTo === null;
            }
            if (clause.effectiveTo?.gt) {
              return (
                p.effectiveTo !== null && p.effectiveTo > clause.effectiveTo.gt
              );
            }
            return false;
          });
          if (!matchesOr) return false;
        }
        if (where.residency) {
          const property = this.properties.get(
            this.residencies.get(p.residencyId)?.propertyId,
          );
          if (
            !this.matchesOrgFilter(
              property,
              where.residency.property.organizationId,
            )
          ) {
            return false;
          }
        }
        return true;
      });
      if (orderBy?.effectiveFrom === 'desc') {
        candidates = candidates.sort(
          (a, b) => b.effectiveFrom - a.effectiveFrom,
        );
      }
      const plan = candidates[0] ?? null;
      if (!plan) return null;
      if (include?.residency) {
        const residency = this.residencies.get(plan.residencyId);
        return {
          ...plan,
          residency: {
            ...residency,
            property: this.properties.get(residency.propertyId),
          },
        };
      }
      return plan;
    },
    update: async ({ where, data }: any) => {
      const plan = this.rentPlans.get(where.id);
      Object.assign(plan, data);
      return plan;
    },
  };

  invoice = {
    create: async ({ data, include }: any) => {
      const dup = [...this.invoices.values()].some(
        (inv) =>
          inv.residencyId === data.residencyId &&
          inv.billingPeriodStart.getTime() ===
            data.billingPeriodStart.getTime() &&
          inv.billingPeriodEnd.getTime() === data.billingPeriodEnd.getTime(),
      );
      if (dup) this.conflict('invoices_residency_billing_period_unique');

      const { items, ...invoiceFields } = data;
      const id = this.nextId();
      const now = new Date();
      const invoice = {
        id,
        issueDate: null,
        currency: 'INR',
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
        ...invoiceFields,
      };
      this.invoices.set(id, invoice);

      const createdItems = (items?.create ?? []).map((itemData: any) => {
        const itemId = this.nextId();
        const item = {
          id: itemId,
          invoiceId: id,
          createdAt: now,
          updatedAt: now,
          ...itemData,
        };
        this.invoiceItems.set(itemId, item);
        return item;
      });

      if (include?.items) {
        return { ...invoice, items: createdItems };
      }
      return invoice;
    },
    findFirst: async ({ where, include }: any) => {
      const invoice = [...this.invoices.values()].find((inv) => {
        if (where.id && inv.id !== where.id) return false;
        if (where.residencyId && inv.residencyId !== where.residencyId)
          return false;
        if (
          where.billingPeriodStart &&
          inv.billingPeriodStart.getTime() !==
            where.billingPeriodStart.getTime()
        ) {
          return false;
        }
        if (
          where.billingPeriodEnd &&
          inv.billingPeriodEnd.getTime() !== where.billingPeriodEnd.getTime()
        ) {
          return false;
        }
        return true;
      });
      if (!invoice) return null;
      return this.attachInvoiceIncludes(invoice, include);
    },
    findUnique: async ({ where }: any) => this.invoices.get(where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const invoice = this.invoices.get(where.id);
      if (!invoice) throw new Error('Invoice not found');
      return invoice;
    },
    findMany: async ({ where, include }: any) => {
      const invoices = [...this.invoices.values()].filter((inv) => {
        if (where?.residency?.propertyId) {
          const residency = this.residencies.get(inv.residencyId);
          if (!residency || residency.propertyId !== where.residency.propertyId)
            return false;
        }
        return true;
      });
      return invoices.map((inv) => this.attachInvoiceIncludes(inv, include));
    },
    update: async ({ where, data, include }: any) => {
      const invoice = this.invoices.get(where.id);
      Object.assign(invoice, data);
      return this.attachInvoiceIncludes(invoice, include);
    },
  };

  private attachInvoiceIncludes(invoice: any, include: any) {
    let result = invoice;
    if (include?.items) {
      result = {
        ...result,
        items: [...this.invoiceItems.values()].filter(
          (i) => i.invoiceId === invoice.id,
        ),
      };
    }
    if (include?.residency) {
      const residency = this.residencies.get(invoice.residencyId);
      const tenant = include.residency.include?.tenant
        ? this.tenants.get(residency.tenantId)
        : undefined;
      result = {
        ...result,
        residency: {
          ...residency,
          ...(tenant ? { tenant } : {}),
          property: this.properties.get(residency.propertyId),
        },
      };
    }
    return result;
  }

  payment = {
    create: async ({ data }: any) => {
      if (
        data.idempotencyKey &&
        [...this.payments.values()].some(
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
        platformFee: new Prisma.Decimal(0),
        ownerSettlementAmount: new Prisma.Decimal(0),
        method: null,
        status: 'CREATED',
        provider: 'RAZORPAY',
        providerOrderId: null,
        providerPaymentId: null,
        idempotencyKey: null,
        failureCode: null,
        failureMessage: null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.payments.set(id, payment);
      return payment;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) return this.payments.get(where.id) ?? null;
      if (where.providerOrderId)
        return (
          [...this.payments.values()].find(
            (p) => p.providerOrderId === where.providerOrderId,
          ) ?? null
        );
      if (where.idempotencyKey)
        return (
          [...this.payments.values()].find(
            (p) => p.idempotencyKey === where.idempotencyKey,
          ) ?? null
        );
      return null;
    },
    findFirst: async ({ where, include }: any) => {
      const payment = [...this.payments.values()].find(
        (p) => p.id === where.id,
      );
      if (!payment) return null;
      if (include?.settlement) {
        return {
          ...payment,
          settlement:
            [...this.ownerSettlements.values()].find(
              (s) => s.paymentId === payment.id,
            ) ?? null,
        };
      }
      return payment;
    },
    findMany: async ({ where, include }: any) => {
      const payments = [...this.payments.values()].filter(
        (p) => p.invoiceId === where.invoiceId,
      );
      return payments.map((p) => ({
        ...p,
        settlement: include?.settlement
          ? ([...this.ownerSettlements.values()].find(
              (s) => s.paymentId === p.id,
            ) ?? null)
          : undefined,
      }));
    },
    update: async ({ where, data }: any) => {
      const payment = this.payments.get(where.id);
      Object.assign(payment, data);
      return payment;
    },
  };

  paymentAllocation = {
    create: async ({ data }: any) => {
      const key = `${data.paymentId}:${data.invoiceId}`;
      if (
        [...this.paymentAllocations.values()].some(
          (a) => `${a.paymentId}:${a.invoiceId}` === key,
        )
      ) {
        this.conflict('payment_allocations_payment_invoice_unique');
      }
      const id = this.nextId();
      const allocation = { id, createdAt: new Date(), ...data };
      this.paymentAllocations.set(id, allocation);
      return allocation;
    },
    findUnique: async ({ where }: any) => {
      const key = where.payment_allocations_payment_invoice_unique;
      if (!key) return null;
      return (
        [...this.paymentAllocations.values()].find(
          (a) => a.paymentId === key.paymentId && a.invoiceId === key.invoiceId,
        ) ?? null
      );
    },
    update: async ({ where, data }: any) => {
      const allocation = this.paymentAllocations.get(where.id);
      Object.assign(allocation, data);
      return allocation;
    },
    aggregate: async ({ where }: any) => {
      const rows = [...this.paymentAllocations.values()].filter(
        (a) => a.invoiceId === where.invoiceId,
      );
      const sum = rows.reduce(
        (acc, r) => acc.plus(r.amount),
        new Prisma.Decimal(0),
      );
      return { _sum: { amount: rows.length > 0 ? sum : null } };
    },
  };

  platformFeeRule = {
    findFirst: async ({ where }: any) =>
      [...this.platformFeeRules.values()]
        .filter((r) =>
          where?.isActive === undefined ? true : r.isActive === where.isActive,
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
  };

  ownerPaymentAccount = {
    findUnique: async ({ where }: any) =>
      [...this.ownerPaymentAccounts.values()].find(
        (a) => a.organizationId === where.organizationId,
      ) ?? null,
  };

  ownerSettlement = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const settlement = {
        id,
        createdAt: now,
        updatedAt: now,
        settledAt: null,
        failureReason: null,
        providerTransferId: null,
        ...data,
      };
      this.ownerSettlements.set(id, settlement);
      return settlement;
    },
    findUnique: async ({ where }: any) =>
      [...this.ownerSettlements.values()].find(
        (s) => s.paymentId === where.paymentId,
      ) ?? null,
    update: async ({ where, data }: any) => {
      const settlement = this.ownerSettlements.get(where.id);
      Object.assign(settlement, data);
      return settlement;
    },
  };

  refund = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const refund = { id, createdAt: now, updatedAt: now, ...data };
      this.refunds.set(id, refund);
      return refund;
    },
    aggregate: async ({ where }: any) => {
      const rows = [...this.refunds.values()].filter(
        (r) => r.paymentId === where.paymentId && r.status === where.status,
      );
      const sum = rows.reduce(
        (acc, r) => acc.plus(r.amount),
        new Prisma.Decimal(0),
      );
      return { _sum: { amount: rows.length > 0 ? sum : null } };
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

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => {
    this.invoiceSeq += 1;
    return [{ nextval: String(this.invoiceSeq) }];
  };
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

// Deterministic in-memory stand-in for RazorpayGatewayService - proves
// the full order -> verify/webhook -> allocation -> settlement HTTP flow
// without calling the real Razorpay API. The real HMAC signature math is
// unit-tested separately (razorpay-gateway.service.spec.ts); the genuine
// concurrent-payment race is proven separately against real Postgres
// (see the Phase 6 final report).
class FakeGateway {
  private orderSeq = 0;
  private refundSeq = 0;
  public nextFetchStatus: 'captured' | 'authorized' = 'captured';

  createOrder = async () => {
    this.orderSeq += 1;
    return { providerOrderId: `order_fake_${this.orderSeq}` };
  };
  verifyPaymentSignature = (input: any) =>
    input.signature === 'valid-signature';
  verifyWebhookSignature = (_raw: Buffer, signature: string) =>
    signature === 'valid-webhook-signature';
  fetchPayment = async () => ({ status: this.nextFetchStatus, method: 'upi' });
  createTransfer = async () => ({
    providerTransferId: 'trf_fake',
    status: 'processed',
  });
  refundPayment = async () => {
    this.refundSeq += 1;
    return {
      providerRefundId: `rfnd_fake_${this.refundSeq}`,
      status: 'processed',
    };
  };
}

describe('Phase 6: tenant payments + platform fee + owner settlement (e2e)', () => {
  let app: INestApplication;
  let throttlerSpy: jest.SpyInstance;
  let gateway: FakeGateway;

  beforeAll(async () => {
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    gateway = new FakeGateway();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(new FakePrisma())
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
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

  async function createProperty(token: string, organizationId: string) {
    const res = await request(server())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        organizationId,
        name: 'Test Property',
        addressLine1: '1 Main St',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500032',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createTenant(token: string) {
    const res = await request(server())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return res.body.data.id as string;
  }

  async function setupInvoice(
    ownerToken: string,
    propertyId: string,
    tenantId: string,
    amount: string,
  ) {
    const resRes = await request(server())
      .post(`/api/v1/properties/${propertyId}/residencies`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
      .expect(201);
    const residencyId = resRes.body.data.id;

    await request(server())
      .post(`/api/v1/residencies/${residencyId}/rent-plan`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount, dueDay: 5, effectiveFrom: '2027-01-01T00:00:00.000Z' })
      .expect(201);

    const invRes = await request(server())
      .post(`/api/v1/residencies/${residencyId}/invoices`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ year: 2027, month: 1 })
      .expect(201);
    const invoiceId = invRes.body.data.id;

    await request(server())
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    return { residencyId, invoiceId };
  }

  describe('Full payment flow: order -> verify -> allocation -> platform fee -> settlement', () => {
    let ownerToken: string;
    let tenantToken: string;
    let invoiceId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('pay-owner-1@example.com');
      const orgId = await createOrg(ownerToken, 'Payments Org 1');
      const propertyId = await createProperty(ownerToken, orgId);
      tenantToken = await registerAndLogin('pay-tenant-1@example.com');
      const tenantId = await createTenant(tenantToken);
      const setup = await setupInvoice(
        ownerToken,
        propertyId,
        tenantId,
        '10000.00',
      );
      invoiceId = setup.invoiceId;
    });

    let paymentId: string;

    it('creates a payment order for the full outstanding balance', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount: '10000.00' })
        .expect(201);

      expect(res.body.data.providerOrderId).toMatch(/^order_fake_/);
      expect(res.body.data.amount).toBe('10000');
      expect(res.body.data.amountInSmallestUnit).toBe(1000000);
      paymentId = res.body.data.paymentId;
    });

    it('rejects an amount exceeding the outstanding balance', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount: '99999.00' })
        .expect(409);
      expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING_BALANCE');
    });

    it('verifies the payment and finalizes it: CAPTURED, correct fee/settlement breakdown, invoice PAID', async () => {
      const orderRes = await request(server())
        .get(`/api/v1/payments/${paymentId}`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);
      const providerOrderId = orderRes.body.data.providerOrderId;

      const res = await request(server())
        .post(`/api/v1/payments/${paymentId}/verify`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: 'pay_fake_1',
          razorpaySignature: 'valid-signature',
        })
        .expect(200);

      expect(res.body.data.status).toBe('CAPTURED');
      expect(res.body.data.amount).toBe('10000');
      expect(res.body.data.platformFee).toBe('1');
      expect(res.body.data.ownerSettlementAmount).toBe('9999');
      expect(res.body.data.settlement.settlementAmount).toBe('9999');
      expect(res.body.data.settlement.status).toBe('PENDING');

      const invoiceRes = await request(server())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(invoiceRes.body.data.status).toBe('PAID');
    });

    it('lists the payment under the invoice, visible to both tenant and owner', async () => {
      const tenantView = await request(server())
        .get(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);
      expect(tenantView.body.data).toHaveLength(1);

      const ownerView = await request(server())
        .get(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(ownerView.body.data).toHaveLength(1);
    });
  });

  describe('Partial payments accumulating to full payment', () => {
    let ownerToken: string;
    let tenantToken: string;
    let invoiceId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('pay-owner-2@example.com');
      const orgId = await createOrg(ownerToken, 'Payments Org 2');
      const propertyId = await createProperty(ownerToken, orgId);
      tenantToken = await registerAndLogin('pay-tenant-2@example.com');
      const tenantId = await createTenant(tenantToken);
      const setup = await setupInvoice(
        ownerToken,
        propertyId,
        tenantId,
        '10000.00',
      );
      invoiceId = setup.invoiceId;
    });

    async function payAndCapture(amount: string) {
      const orderRes = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount })
        .expect(201);
      const { paymentId, providerOrderId } = orderRes.body.data;

      return request(server())
        .post(`/api/v1/payments/${paymentId}/verify`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          razorpayOrderId: providerOrderId,
          razorpayPaymentId: `pay_fake_${paymentId}`,
          razorpaySignature: 'valid-signature',
        })
        .expect(200);
    }

    it('first partial payment moves the invoice to PARTIALLY_PAID', async () => {
      await payAndCapture('4000.00');

      const res = await request(server())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('PARTIALLY_PAID');
    });

    it('rejects a second payment larger than the remaining balance', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount: '7000.00' })
        .expect(409);
      expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING_BALANCE');
    });

    it('the remaining payment brings the invoice to PAID', async () => {
      await payAndCapture('6000.00');

      const res = await request(server())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('PAID');
    });
  });

  describe('Refund foundation', () => {
    let ownerToken: string;
    let tenantToken: string;
    let invoiceId: string;
    let paymentId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('pay-owner-3@example.com');
      const orgId = await createOrg(ownerToken, 'Payments Org 3');
      const propertyId = await createProperty(ownerToken, orgId);
      tenantToken = await registerAndLogin('pay-tenant-3@example.com');
      const tenantId = await createTenant(tenantToken);
      const setup = await setupInvoice(
        ownerToken,
        propertyId,
        tenantId,
        '5000.00',
      );
      invoiceId = setup.invoiceId;

      const orderRes = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount: '5000.00' })
        .expect(201);
      paymentId = orderRes.body.data.paymentId;
      await request(server())
        .post(`/api/v1/payments/${paymentId}/verify`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({
          razorpayOrderId: orderRes.body.data.providerOrderId,
          razorpayPaymentId: 'pay_fake_refund',
          razorpaySignature: 'valid-signature',
        })
        .expect(200);
    });

    it('rejects the tenant refunding their own payment', async () => {
      await request(server())
        .post(`/api/v1/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({})
        .expect(403);
    });

    it('OWNER can fully refund a captured payment, and the invoice steps back down from PAID', async () => {
      const res = await request(server())
        .post(`/api/v1/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: 'Duplicate payment' })
        .expect(200);
      expect(res.body.data.status).toBe('REFUNDED');

      const invoiceRes = await request(server())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(invoiceRes.body.data.status).not.toBe('PAID');
    });

    it('rejects refunding an already-fully-refunded payment', async () => {
      await request(server())
        .post(`/api/v1/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(409);
    });
  });

  describe('Razorpay webhook: idempotent finalization', () => {
    let ownerToken: string;
    let tenantToken: string;
    let invoiceId: string;
    let paymentId: string;
    let providerOrderId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('pay-owner-4@example.com');
      const orgId = await createOrg(ownerToken, 'Payments Org 4');
      const propertyId = await createProperty(ownerToken, orgId);
      tenantToken = await registerAndLogin('pay-tenant-4@example.com');
      const tenantId = await createTenant(tenantToken);
      const setup = await setupInvoice(
        ownerToken,
        propertyId,
        tenantId,
        '3000.00',
      );
      invoiceId = setup.invoiceId;

      const orderRes = await request(server())
        .post(`/api/v1/invoices/${invoiceId}/payments/order`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ amount: '3000.00' })
        .expect(201);
      paymentId = orderRes.body.data.paymentId;
      providerOrderId = orderRes.body.data.providerOrderId;
    });

    function webhookBody() {
      return {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_fake_webhook',
              order_id: providerOrderId,
              method: 'card',
            },
          },
        },
      };
    }

    it('rejects a webhook with an invalid signature', async () => {
      await request(server())
        .post('/api/v1/payments/webhooks/razorpay')
        .set('x-razorpay-signature', 'not-valid')
        .set('x-razorpay-event-id', 'evt_1')
        .send(webhookBody())
        .expect(401);
    });

    it('finalizes the payment on a verified webhook', async () => {
      await request(server())
        .post('/api/v1/payments/webhooks/razorpay')
        .set('x-razorpay-signature', 'valid-webhook-signature')
        .set('x-razorpay-event-id', 'evt_1')
        .send(webhookBody())
        .expect(200);

      const res = await request(server())
        .get(`/api/v1/payments/${paymentId}`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('CAPTURED');

      const invoiceRes = await request(server())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(invoiceRes.body.data.status).toBe('PAID');
    });

    it('a duplicate delivery of the same event is a no-op (idempotent)', async () => {
      await request(server())
        .post('/api/v1/payments/webhooks/razorpay')
        .set('x-razorpay-signature', 'valid-webhook-signature')
        .set('x-razorpay-event-id', 'evt_1')
        .send(webhookBody())
        .expect(200);

      const res = await request(server())
        .get(`/api/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      // Still exactly one payment, one allocation's worth of PAID status -
      // a second finalize would have thrown on the allocation unique
      // constraint if idempotency had failed.
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('Cross-tenant and cross-organization security', () => {
    let ownerAToken: string;
    let tenantAToken: string;
    let outsiderToken: string;
    let invoiceAId: string;
    let paymentAId: string;

    beforeAll(async () => {
      ownerAToken = await registerAndLogin('sec6ownerA@example.com');
      const orgAId = await createOrg(ownerAToken, 'Sec6 Org A');
      const propertyAId = await createProperty(ownerAToken, orgAId);
      tenantAToken = await registerAndLogin('sec6tenantA@example.com');
      const tenantAId = await createTenant(tenantAToken);
      const setup = await setupInvoice(
        ownerAToken,
        propertyAId,
        tenantAId,
        '8000.00',
      );
      invoiceAId = setup.invoiceId;

      const orderRes = await request(server())
        .post(`/api/v1/invoices/${invoiceAId}/payments/order`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ amount: '1000.00' })
        .expect(201);
      paymentAId = orderRes.body.data.paymentId;

      outsiderToken = await registerAndLogin('sec6outsider@example.com');
    });

    it("an unrelated user cannot create a payment order for Tenant A's invoice", async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${invoiceAId}/payments/order`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ amount: '1000.00' })
        .expect(404);
      expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
    });

    it("an unrelated user cannot view Tenant A's payment", async () => {
      const res = await request(server())
        .get(`/api/v1/payments/${paymentAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
    });

    it("an unrelated user cannot verify Tenant A's payment", async () => {
      await request(server())
        .post(`/api/v1/payments/${paymentAId}/verify`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({
          razorpayOrderId: 'order_fake_x',
          razorpayPaymentId: 'pay_x',
          razorpaySignature: 'valid-signature',
        })
        .expect(404);
    });

    it('an unrelated user (not OWNER/MANAGER) cannot refund the payment', async () => {
      await request(server())
        .post(`/api/v1/payments/${paymentAId}/refund`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({})
        .expect(403);
    });

    it("Owner A can still view Tenant A's payment normally", async () => {
      const res = await request(server())
        .get(`/api/v1/payments/${paymentAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(paymentAId);
    });
  });
});
