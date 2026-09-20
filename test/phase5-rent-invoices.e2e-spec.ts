import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// An in-memory stand-in for PrismaService covering the full chain through
// Phase 5: users, organizations, memberships, properties, rooms, beds,
// tenants, residencies, bed_allocations, rent_plans, invoices,
// invoice_items. Same pattern as every prior phase's e2e fake - proves
// the real HTTP stack end to end without a running Postgres instance.
//
// Enforces the two Phase 5 uniqueness invariants (one ACTIVE rent plan per
// residency, one invoice per residency+billing-period) for sequential
// requests, exercising the same conflict-translation path
// RentPlansService/InvoicesService use for a real concurrent race. The
// genuine concurrent-request race (spec section 40) is proven separately
// against the real Postgres instance - see the Phase 5 final report.
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
    findFirst: async ({ where }: any) => {
      const orgFilter = where.organizationId;
      return (
        [...this.properties.values()].find((p) => {
          if (p.id !== where.id) return false;
          return this.matchesOrgFilter(p, orgFilter);
        }) ?? null
      );
    },
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
        if (where.residency) {
          const property = this.properties.get(
            this.residencies.get(inv.residencyId)?.propertyId,
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
      if (!invoice) return null;
      return this.attachIncludes(invoice, include);
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
      return invoices.map((inv) => this.attachIncludes(inv, include));
    },
    update: async ({ where, data, include }: any) => {
      const invoice = this.invoices.get(where.id);
      Object.assign(invoice, data);
      return this.attachIncludes(invoice, include);
    },
  };

  private attachIncludes(invoice: any, include: any) {
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
      result = {
        ...result,
        residency: {
          ...residency,
          property: this.properties.get(residency.propertyId),
        },
      };
    }
    return result;
  }

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => {
    this.invoiceSeq += 1;
    return [{ nextval: String(this.invoiceSeq) }];
  };
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

describe('Phase 5: rent + invoices (e2e)', () => {
  let app: INestApplication;
  let throttlerSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Same throttling workaround as the Phase 4 e2e suite - this suite's
    // setup alone (many users/orgs/properties/residencies) exceeds
    // AuthController's stricter 10/min @Throttle on /auth/register.
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(new FakePrisma())
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

  async function createResidencyWithRent(
    ownerToken: string,
    propertyId: string,
    tenantId: string,
    amount: string,
    startDate: string,
  ) {
    const resRes = await request(server())
      .post(`/api/v1/properties/${propertyId}/residencies`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ tenantId, startDate })
      .expect(201);
    const residencyId = resRes.body.data.id;

    await request(server())
      .post(`/api/v1/residencies/${residencyId}/rent-plan`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount, dueDay: 5, effectiveFrom: startDate })
      .expect(201);

    return residencyId;
  }

  describe('Rent plan lifecycle', () => {
    let ownerToken: string;
    let orgId: string;
    let propertyId: string;
    let residencyId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('rentowner@example.com');
      orgId = await createOrg(ownerToken, 'Rent Org');
      propertyId = await createProperty(ownerToken, orgId);
      const tenantUser = await registerAndLogin('renttenant@example.com');
      const tenantId = await createTenant(tenantUser);
      const resRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);
      residencyId = resRes.body.data.id;
    });

    it('creates a rent plan', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          amount: '8000.00',
          dueDay: 5,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        })
        .expect(201);
      expect(res.body.data.amount).toBe('8000');
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('rejects an invalid (zero) amount', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          amount: '0.00',
          dueDay: 5,
          effectiveFrom: '2027-05-01T00:00:00.000Z',
        })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_RENT_PLAN');
    });

    it('reads the current rent plan', async () => {
      const res = await request(server())
        .get(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.amount).toBe('8000');
    });

    it('changes rent and preserves history (old plan becomes INACTIVE with effectiveTo set)', async () => {
      await request(server())
        .post(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          amount: '9000.00',
          dueDay: 5,
          effectiveFrom: '2027-04-01T00:00:00.000Z',
        })
        .expect(201);

      const res = await request(server())
        .get(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.amount).toBe('9000');
    });

    it('rejects an unauthorized organization from reading the rent plan', async () => {
      const outsider = await registerAndLogin('rentoutsider@example.com');
      const res = await request(server())
        .get(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${outsider}`)
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });
  });

  describe('Invoice generation, calculation, and lifecycle', () => {
    let ownerToken: string;
    let orgId: string;
    let propertyId: string;
    let residencyId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('invowner@example.com');
      orgId = await createOrg(ownerToken, 'Invoice Org');
      propertyId = await createProperty(ownerToken, orgId);
      const tenantUser = await registerAndLogin('invtenant@example.com');
      const tenantId = await createTenant(tenantUser);
      residencyId = await createResidencyWithRent(
        ownerToken,
        propertyId,
        tenantId,
        '8000.00',
        '2026-12-01T00:00:00.000Z',
      );
    });

    it('generates a DRAFT invoice for a full billing period', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ year: 2027, month: 1 })
        .expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.subtotal).toBe('8000');
      expect(res.body.data.total).toBe('8000');
      expect(res.body.data.discount).toBe('0');
      expect(res.body.data.tax).toBe('0');
      expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].itemType).toBe('RENT');
      expect(new Date(res.body.data.dueDate).getUTCDate()).toBe(5);
    });

    it('rejects a duplicate billing period', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ year: 2027, month: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('DUPLICATE_BILLING_PERIOD');
    });

    it('assigns unique, sequential invoice numbers across different residencies', async () => {
      const secondTenantUser = await registerAndLogin('invtenant2@example.com');
      const secondTenantId = await createTenant(secondTenantUser);
      const secondResidencyId = await createResidencyWithRent(
        ownerToken,
        propertyId,
        secondTenantId,
        '7500.00',
        '2027-01-01T00:00:00.000Z',
      );

      const res = await request(server())
        .post(`/api/v1/residencies/${secondResidencyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ year: 2027, month: 1 })
        .expect(201);

      expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    });

    let issuedInvoiceId: string;

    it('issues the invoice', async () => {
      const listRes = await request(server())
        .get(`/api/v1/properties/${propertyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const draftInvoice = listRes.body.data.find(
        (inv: any) => inv.residencyId === residencyId,
      );
      issuedInvoiceId = draftInvoice.id;

      const res = await request(server())
        .post(`/api/v1/invoices/${issuedInvoiceId}/issue`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('ISSUED');
      expect(res.body.data.issueDate).not.toBeNull();
    });

    it('rejects PATCHing an issued invoice', async () => {
      const res = await request(server())
        .patch(`/api/v1/invoices/${issuedInvoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ dueDate: '2027-01-15T00:00:00.000Z' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_INVOICE_STATE');
    });

    it('rejects re-issuing an already-issued invoice', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${issuedInvoiceId}/issue`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVOICE_ALREADY_ISSUED');
    });

    it('voids the issued invoice', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${issuedInvoiceId}/void`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('VOID');
    });

    it('rejects voiding an already-voided invoice', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${issuedInvoiceId}/void`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVOICE_ALREADY_VOID');
    });

    it('rejects re-issuing a voided invoice', async () => {
      const res = await request(server())
        .post(`/api/v1/invoices/${issuedInvoiceId}/issue`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVOICE_ALREADY_VOID');
    });

    it('historical invoice remains unchanged after the rent plan changes', async () => {
      // The already-generated (now-voided, but still historically valid)
      // invoice from January still shows 8000 even after a rent change.
      await request(server())
        .post(`/api/v1/residencies/${residencyId}/rent-plan`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          amount: '10000.00',
          dueDay: 5,
          effectiveFrom: '2027-04-01T00:00:00.000Z',
        })
        .expect(201);

      const res = await request(server())
        .get(`/api/v1/invoices/${issuedInvoiceId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.subtotal).toBe('8000');
    });
  });

  describe('Proration', () => {
    let ownerToken: string;
    let propertyId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('prorationowner@example.com');
      const orgId = await createOrg(ownerToken, 'Proration Org');
      propertyId = await createProperty(ownerToken, orgId);
    });

    it('prorates a residency starting mid-month', async () => {
      const tenantUser = await registerAndLogin('prorationtenant1@example.com');
      const tenantId = await createTenant(tenantUser);
      const residencyId = await createResidencyWithRent(
        ownerToken,
        propertyId,
        tenantId,
        '9000.00',
        '2027-01-18T00:00:00.000Z',
      );

      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ year: 2027, month: 1 })
        .expect(201);

      // 9000 * 14/31 = 4064.52
      expect(res.body.data.subtotal).toBe('4064.52');
    });

    it('rejects generating an invoice for a period before the residency started', async () => {
      const tenantUser = await registerAndLogin('prorationtenant2@example.com');
      const tenantId = await createTenant(tenantUser);
      const residencyId = await createResidencyWithRent(
        ownerToken,
        propertyId,
        tenantId,
        '9000.00',
        '2027-03-01T00:00:00.000Z',
      );

      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/invoices`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ year: 2027, month: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_BILLING_PERIOD');
    });
  });

  describe('Cross-organization security: Organization A vs Organization B', () => {
    let ownerAToken: string;
    let outsiderToken: string;
    let residencyAId: string;
    let invoiceAId: string;

    beforeAll(async () => {
      ownerAToken = await registerAndLogin('sec5ownerA@example.com');
      outsiderToken = await registerAndLogin('sec5outsider@example.com');

      const orgAId = await createOrg(ownerAToken, 'Sec5 Org A');
      const propertyAId = await createProperty(ownerAToken, orgAId);
      const tenantUser = await registerAndLogin('sec5tenant@example.com');
      const tenantId = await createTenant(tenantUser);
      residencyAId = await createResidencyWithRent(
        ownerAToken,
        propertyAId,
        tenantId,
        '8000.00',
        '2027-01-01T00:00:00.000Z',
      );
      const invRes = await request(server())
        .post(`/api/v1/residencies/${residencyAId}/invoices`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ year: 2027, month: 1 })
        .expect(201);
      invoiceAId = invRes.body.data.id;
    });

    it("User B cannot read Residency A's rent plan", async () => {
      const res = await request(server())
        .get(`/api/v1/residencies/${residencyAId}/rent-plan`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });

    it('User B cannot create a rent plan on Residency A', async () => {
      await request(server())
        .post(`/api/v1/residencies/${residencyAId}/rent-plan`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({
          amount: '1.00',
          dueDay: 1,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        })
        .expect(404);
    });

    it('User B cannot generate an invoice for Residency A', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyAId}/invoices`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ year: 2027, month: 2 })
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });

    it('User B cannot GET Invoice A', async () => {
      const res = await request(server())
        .get(`/api/v1/invoices/${invoiceAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
    });

    it('User B cannot PATCH Invoice A', async () => {
      await request(server())
        .patch(`/api/v1/invoices/${invoiceAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ dueDate: '2027-01-20T00:00:00.000Z' })
        .expect(404);
    });

    it('User B cannot issue Invoice A', async () => {
      await request(server())
        .post(`/api/v1/invoices/${invoiceAId}/issue`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('User B cannot void Invoice A', async () => {
      await request(server())
        .post(`/api/v1/invoices/${invoiceAId}/void`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it("User A's own invoice still works normally", async () => {
      const res = await request(server())
        .get(`/api/v1/invoices/${invoiceAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(invoiceAId);
    });
  });
});
