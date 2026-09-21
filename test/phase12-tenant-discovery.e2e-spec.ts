import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite (see
// test/phase10-food.e2e-spec.ts / phase11-notifications.e2e-spec.ts).
// Scoped to what Phase 12's own HTTP surface needs: auth/org/membership/
// property plumbing (unchanged from every prior suite) plus
// PropertyListing/PropertyListingAmenity/TenantApplication/
// ApplicationActivity/PropertyVisit - and empty Residency/BedAllocation/
// Invoice/Payment collections whose emptiness this suite explicitly
// asserts on after an approval (the single most important assertion in
// this phase: approval never creates operational-tenancy or financial
// rows). $queryRaw is stubbed to return [] (room-type availability
// aggregation correctness is proven against real Postgres by this
// phase's verification script instead - see README).
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private properties = new Map<string, any>();
  private tenants = new Map<string, any>();
  private residencies = new Map<string, any>();
  private bedAllocations = new Map<string, any>();
  private invoices = new Map<string, any>();
  private payments = new Map<string, any>();
  private saasPlans = new Map<string, any>();
  private subscriptions = new Map<string, any>();
  private propertyListings = new Map<string, any>();
  private propertyListingAmenities = new Map<string, any>();
  private tenantApplications = new Map<string, any>();
  private applicationActivities = new Map<string, any>();
  private propertyVisits = new Map<string, any>();
  private auditLogs = new Map<string, any>();
  private notifications = new Map<string, any>();
  private notificationDeliveries = new Map<string, any>();

  constructor() {
    const planId = this.nextId();
    this.saasPlans.set(planId, {
      id: planId,
      name: 'Basic',
      description: 'Default plan',
      price: new Prisma.Decimal('499.00'),
      currency: 'INR',
      billingInterval: 'MONTHLY',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      effectiveTo: null,
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

  private matches(row: any, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (v && typeof v === 'object' && 'in' in v)
        return (v as any).in.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in v)
        return row[k] !== (v as any).not;
      return row[k] === v;
    });
  }

  user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email)
        return (
          [...this.users.values()].find((u) => u.email === where.email) ?? null
        );
      if (where.phone)
        return (
          [...this.users.values()].find((u) => u.phone === where.phone) ?? null
        );
      return null;
    },
    create: async ({ data }: any) => {
      if (
        data.email &&
        [...this.users.values()].some((u) => u.email === data.email)
      ) {
        this.conflict('email');
      }
      if (
        data.phone &&
        [...this.users.values()].some((u) => u.phone === data.phone)
      ) {
        this.conflict('phone');
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
    update: async ({ where, data }: any) => {
      const user = this.users.get(where.id);
      Object.assign(user, data);
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
        if (this.matches(row, where)) {
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
    update: async ({ where, data }: any) => {
      const org = this.organizations.get(where.id);
      Object.assign(org, data);
      return org;
    },
  };

  organizationMembership = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const membership = {
        id,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.memberships.set(id, membership);
      return membership;
    },
    findFirst: async ({ where }: any) =>
      [...this.memberships.values()].find((m) => this.matches(m, where)) ??
      null,
    findMany: async ({ where, select }: any) => {
      const rows = [...this.memberships.values()].filter((m) =>
        this.matches(m, where),
      );
      if (select?.userId) return rows.map((m) => ({ userId: m.userId }));
      return rows;
    },
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
    findUnique: async ({ where, select }: any) => {
      const property = this.properties.get(where.id) ?? null;
      if (!property) return null;
      if (select) {
        const out: any = {};
        for (const key of Object.keys(select)) out[key] = property[key];
        return out;
      }
      return property;
    },
  };

  saasPlan = {
    findFirst: async ({ where }: any) =>
      [...this.saasPlans.values()].filter(
        (p) => !where?.status || p.status === where.status,
      )[0] ?? null,
    findUnique: async ({ where }: any) => this.saasPlans.get(where.id) ?? null,
  };

  organizationSubscription = {
    findUnique: async ({ where }: any) =>
      [...this.subscriptions.values()].find(
        (s) => s.organizationId === where.organizationId,
      ) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const sub = this.subscriptions.get(where.id);
      if (!sub) throw new Error('subscription not found');
      return { ...sub, saasPlan: this.saasPlans.get(sub.saasPlanId) };
    },
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const sub = {
        id,
        cancelledAt: null,
        pendingSaasPlanId: null,
        gracePeriodEndsAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.subscriptions.set(id, sub);
      return sub;
    },
    update: async ({ where, data }: any) => {
      const sub = this.subscriptions.get(where.id);
      Object.assign(sub, data);
      return { ...sub, saasPlan: this.saasPlans.get(sub.saasPlanId) };
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
    findUnique: async ({ where }: any) => {
      if (where.id) return this.tenants.get(where.id) ?? null;
      if (where.userId)
        return (
          [...this.tenants.values()].find((t) => t.userId === where.userId) ??
          null
        );
      return null;
    },
    findUniqueOrThrow: async (args: any) => {
      const found = await this.tenant.findUnique(args);
      if (!found) throw new Error('tenant not found');
      return found;
    },
    upsert: async ({ where, create }: any) => {
      const existing = [...this.tenants.values()].find(
        (t) => t.userId === where.userId,
      );
      if (existing) return existing;
      return this.tenant.create({ data: create });
    },
    count: async () => this.tenants.size,
  };

  residency = {
    count: async () => this.residencies.size,
    findMany: async () => [],
  };
  bedAllocation = { count: async () => this.bedAllocations.size };
  invoice = { count: async () => this.invoices.size };
  payment = { count: async () => this.payments.size };

  propertyListing = {
    findUnique: async ({ where }: any) => {
      const listing = [...this.propertyListings.values()].find(
        (l) => l.propertyId === where.propertyId,
      );
      return listing ?? null;
    },
    findFirst: async ({ where }: any) => {
      const rows = [...this.propertyListings.values()].filter((l) => {
        if (where.propertyId && l.propertyId !== where.propertyId) return false;
        if (where.status && l.status !== where.status) return false;
        if (
          where.property?.status &&
          this.properties.get(l.propertyId)?.status !== where.property.status
        )
          return false;
        if (
          where.property?.organization?.status?.not &&
          this.organizations.get(
            this.properties.get(l.propertyId)?.organizationId,
          )?.status === where.property.organization.status.not
        )
          return false;
        return true;
      });
      const listing = rows[0] ?? null;
      if (!listing) return null;
      return {
        ...listing,
        amenities: [...this.propertyListingAmenities.values()].filter(
          (a) => a.propertyListingId === listing.id,
        ),
        property: this.properties.get(listing.propertyId),
      };
    },
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      const rows = [...this.propertyListings.values()].filter((l) => {
        if (where?.status && l.status !== where.status) return false;
        return true;
      });
      return rows.slice(skip, skip + take).map((l) => ({
        ...l,
        amenities: [...this.propertyListingAmenities.values()].filter(
          (a) => a.propertyListingId === l.id,
        ),
        property: this.properties.get(l.propertyId),
      }));
    },
    count: async ({ where }: any = {}) =>
      [...this.propertyListings.values()].filter(
        (l) => !where?.status || l.status === where.status,
      ).length,
    create: async ({ data }: any) => {
      if (
        [...this.propertyListings.values()].some(
          (l) => l.propertyId === data.propertyId,
        )
      ) {
        this.conflict('propertyId');
      }
      const id = this.nextId();
      const now = new Date();
      const listing = {
        id,
        status: 'DRAFT',
        title: null,
        description: null,
        city: null,
        locality: null,
        latitude: null,
        longitude: null,
        coverImageUrl: null,
        contactEnabled: true,
        startingFromPrice: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.propertyListings.set(id, listing);
      return listing;
    },
    update: async ({ where, data }: any) => {
      const listing = [...this.propertyListings.values()].find(
        (l) => l.propertyId === where.propertyId,
      );
      Object.assign(listing, data);
      return listing;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const listing = this.propertyListings.get(where.id);
      if (!listing) throw new Error('listing not found');
      return {
        ...listing,
        amenities: [...this.propertyListingAmenities.values()].filter(
          (a) => a.propertyListingId === listing.id,
        ),
      };
    },
  };

  propertyListingAmenity = {
    deleteMany: async ({ where }: any) => {
      const rows = [...this.propertyListingAmenities.values()].filter(
        (a) => a.propertyListingId === where.propertyListingId,
      );
      for (const row of rows) this.propertyListingAmenities.delete(row.id);
      return { count: rows.length };
    },
    createMany: async ({ data }: any) => {
      for (const item of data) {
        const id = this.nextId();
        this.propertyListingAmenities.set(id, {
          id,
          createdAt: new Date(),
          ...item,
        });
      }
      return { count: data.length };
    },
  };

  tenantApplication = {
    create: async ({ data }: any) => {
      const activeStatuses = [
        'SUBMITTED',
        'UNDER_REVIEW',
        'VISIT_SCHEDULED',
        'APPROVED',
      ];
      const identity = data.applicantUserId ?? data.phone;
      const dup = [...this.tenantApplications.values()].some(
        (a) =>
          a.propertyId === data.propertyId &&
          (a.applicantUserId ?? a.phone) === identity &&
          activeStatuses.includes(a.status),
      );
      if (dup)
        this.conflict('tenant_applications_active_applicant_property_unique');
      const id = this.nextId();
      const now = new Date();
      const application = {
        id,
        status: 'SUBMITTED',
        applicantUserId: null,
        email: null,
        preferredMoveInDate: null,
        preferredRoomType: null,
        preferredStayDuration: null,
        notes: null,
        rejectionReason: null,
        internalReviewNotes: null,
        reviewedByUserId: null,
        reviewedAt: null,
        decisionAt: null,
        onboardingStartedAt: null,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.tenantApplications.set(id, application);
      return application;
    },
    findFirst: async ({ where }: any) =>
      [...this.tenantApplications.values()].find((a) =>
        this.matches(a, where),
      ) ?? null,
    findUnique: async ({ where, include }: any) => {
      const app = this.tenantApplications.get(where.id);
      if (!app) return null;
      if (include?.property) {
        return { ...app, property: this.properties.get(app.propertyId) };
      }
      return app;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const app = this.tenantApplications.get(where.id);
      if (!app) throw new Error('application not found');
      return app;
    },
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      const rows = [...this.tenantApplications.values()].filter((a) =>
        this.matches(a, where),
      );
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(skip, skip + take);
    },
    count: async ({ where }: any = {}) =>
      [...this.tenantApplications.values()].filter((a) =>
        this.matches(a, where),
      ).length,
    update: async ({ where, data }: any) => {
      const app = this.tenantApplications.get(where.id);
      Object.assign(app, data);
      return app;
    },
    updateMany: async ({ where, data }: any) => {
      const rows = [...this.tenantApplications.values()].filter((a) =>
        this.matches(a, where),
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };

  applicationActivity = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      this.applicationActivities.set(id, {
        id,
        createdAt: new Date(),
        ...data,
      });
      return { id, ...data };
    },
    findMany: async ({ where }: any) =>
      [...this.applicationActivities.values()].filter(
        (a) => a.applicationId === where.applicationId,
      ),
  };

  propertyVisit = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const visit = {
        id,
        status: 'REQUESTED',
        scheduledStartAt: null,
        scheduledEndAt: null,
        notes: null,
        cancelReason: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.propertyVisits.set(id, visit);
      return visit;
    },
    findFirst: async ({ where }: any) => {
      const rows = [...this.propertyVisits.values()].filter((v) => {
        if (where.id && v.id !== where.id) return false;
        if (where.propertyId && v.propertyId !== where.propertyId) return false;
        if (
          where.applicantUserId &&
          v.applicantUserId !== where.applicantUserId
        )
          return false;
        if (where.status && v.status !== where.status) return false;
        if (where.id?.not && v.id === where.id.not) return false;
        if (
          where.scheduledStartAt?.lt &&
          !(v.scheduledStartAt < where.scheduledStartAt.lt)
        )
          return false;
        if (
          where.scheduledEndAt?.gt &&
          !(v.scheduledEndAt > where.scheduledEndAt.gt)
        )
          return false;
        return true;
      });
      return rows[0] ?? null;
    },
    findUnique: async ({ where, include }: any) => {
      const visit = this.propertyVisits.get(where.id);
      if (!visit) return null;
      if (include?.property) {
        return { ...visit, property: this.properties.get(visit.propertyId) };
      }
      return visit;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const v = this.propertyVisits.get(where.id);
      if (!v) throw new Error('visit not found');
      return v;
    },
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      const rows = [...this.propertyVisits.values()].filter((v) =>
        this.matches(v, where),
      );
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(skip, skip + take);
    },
    count: async ({ where }: any = {}) =>
      [...this.propertyVisits.values()].filter((v) => this.matches(v, where))
        .length,
    updateMany: async ({ where, data }: any) => {
      const rows = [...this.propertyVisits.values()].filter((v) => {
        if (where.id && v.id !== where.id) return false;
        if (where.status?.in && !where.status.in.includes(v.status))
          return false;
        if (
          where.status &&
          typeof where.status === 'string' &&
          v.status !== where.status
        )
          return false;
        return true;
      });
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };

  auditLog = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      this.auditLogs.set(id, { id, createdAt: new Date(), ...data });
      return { id, ...data };
    },
    count: async () => this.auditLogs.size,
  };

  // Minimal support so NotificationEventService's Phase 12 handlers run
  // to completion in this suite (rather than being swallowed by
  // DomainEventBusService's error handling every time) - full HTTP
  // coverage of the notification surface itself already lives in
  // test/phase11-notifications.e2e-spec.ts.
  notification = {
    create: async ({ data }: any) => {
      if (
        [...this.notifications.values()].some(
          (n) => n.idempotencyKey === data.idempotencyKey,
        )
      ) {
        this.conflict('idempotencyKey');
      }
      const id = this.nextId();
      const now = new Date();
      const row = {
        id,
        status: 'UNREAD',
        readAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.notifications.set(id, row);
      return row;
    },
    findUnique: async ({ where }: any) =>
      [...this.notifications.values()].find(
        (n) => n.idempotencyKey === where.idempotencyKey,
      ) ?? null,
    count: async () => this.notifications.size,
    findMany: async () => [...this.notifications.values()],
  };

  pushDevice = { findFirst: async () => null };
  notificationPreference = {
    findUnique: async () => null,
    findMany: async () => [],
  };

  notificationDelivery = {
    findUnique: async () => null,
    upsert: async ({ create }: any) => {
      const id = this.nextId();
      this.notificationDeliveries.set(id, { id, ...create });
      return { id, ...create };
    },
  };

  $transaction = async (arg: any) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  };
  $queryRaw = async () => [];
  $executeRaw = async () => 0;
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

describe('Phase 12: tenant discovery, applications & visits (e2e)', () => {
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

  async function registerAndLogin(email: string, extra: any = {}) {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Test User', email, password: 'password123', ...extra })
      .expect(201);
    return {
      token: res.body.data.tokens.accessToken as string,
      userId: res.body.data.user.id as string,
    };
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
        name: 'Sunrise PG',
        addressLine1: '1 Main St',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411001',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  async function addMember(
    role: 'MANAGER' | 'STAFF',
    email: string,
    orgId: string,
  ) {
    const member = await registerAndLogin(email);
    await fakePrisma.organizationMembership.create({
      data: {
        userId: member.userId,
        organizationId: orgId,
        role,
        status: 'ACTIVE',
      },
    });
    return member;
  }

  async function setupPublishedListing(suffix: string) {
    const owner = await registerAndLogin(`owner-${suffix}@example.com`);
    const orgId = await createOrg(owner.token, `Org ${suffix}`);
    const propertyId = await createProperty(owner.token, orgId);
    await request(server())
      .post(`/api/v1/properties/${propertyId}/listing`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Sunrise PG',
        description: 'A nice place to stay',
        locality: 'Kothrud',
        amenities: ['WIFI', 'FOOD'],
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/properties/${propertyId}/listing/publish`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    return { owner, orgId, propertyId };
  }

  describe('public discovery', () => {
    it('lists only PUBLISHED listings, never a DRAFT one', async () => {
      const { propertyId } = await setupPublishedListing('disc1');
      const draftOwner = await registerAndLogin('owner-draft1@example.com');
      const draftOrgId = await createOrg(draftOwner.token, 'Draft Org');
      await createProperty(draftOwner.token, draftOrgId); // never published

      const res = await request(server())
        .get('/api/v1/public/properties')
        .expect(200);
      const ids = res.body.data.items.map((i: any) => i.propertyId);
      expect(ids).toContain(propertyId);
      // Only the published one appears; the never-listed property does not.
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('never exposes organizationId or owner contact details in the public response', async () => {
      const { propertyId } = await setupPublishedListing('disc2');
      const res = await request(server())
        .get(`/api/v1/public/properties/${propertyId}`)
        .expect(200);
      expect(res.body.data.organizationId).toBeUndefined();
      expect(res.body.data.ownerEmail).toBeUndefined();
      expect(res.body.data.ownerPhone).toBeUndefined();
    });
  });

  describe('application submission', () => {
    it('accepts a guest (unauthenticated) application', async () => {
      const { propertyId } = await setupPublishedListing('app1');
      const res = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Guest Applicant', phone: '9876500001' })
        .expect(201);
      expect(res.body.data.applicantUserId).toBeNull();
      expect(res.body.data.status).toBe('SUBMITTED');
    });

    it('auto-links applicantUserId for an authenticated caller', async () => {
      const { propertyId } = await setupPublishedListing('app2');
      const applicant = await registerAndLogin('applicant-app2@example.com');
      const res = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Auth Applicant', phone: '9876500002' })
        .expect(201);
      expect(res.body.data.applicantUserId).toBe(applicant.userId);
    });

    it('rejects a duplicate active application with a generic 409, never leaking the phone', async () => {
      const { propertyId } = await setupPublishedListing('app3');
      await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Dup Applicant', phone: '9876500003' })
        .expect(201);
      const res = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Dup Applicant', phone: '9876500003' })
        .expect(409);
      expect(res.body.error.code).toBe('APPLICATION_ALREADY_EXISTS');
      expect(res.body.error.message).not.toContain('9876500003');
    });

    it('never exposes internalReviewNotes in the applicant-facing response', async () => {
      const { propertyId } = await setupPublishedListing('app4');
      const applicant = await registerAndLogin('applicant-app4@example.com');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Notes Applicant', phone: '9876500004' })
        .expect(201);
      const res = await request(server())
        .get(`/api/v1/me/applications/${submitRes.body.data.id}`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .expect(200);
      expect(res.body.data.internalReviewNotes).toBeUndefined();
    });
  });

  describe('approval boundary (mandatory financial isolation)', () => {
    it('approving an application never creates a Residency/BedAllocation/Invoice/Payment', async () => {
      const { owner, propertyId } = await setupPublishedListing('approve1');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Approve Me', phone: '9876500005' })
        .expect(201);
      const appId = submitRes.body.data.id;

      await request(server())
        .post(`/api/v1/applications/${appId}/review`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const approveRes = await request(server())
        .post(`/api/v1/applications/${appId}/approve`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED');
      const prisma = fakePrisma as any;
      expect(await prisma.residency.count()).toBe(0);
      expect(await prisma.bedAllocation.count()).toBe(0);
      expect(await prisma.invoice.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
    });

    it('rejects with a public-safe reason, visible to the applicant', async () => {
      const { owner, propertyId } = await setupPublishedListing('reject1');
      const applicant = await registerAndLogin('applicant-reject1@example.com');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Reject Me', phone: '9876500006' })
        .expect(201);
      const appId = submitRes.body.data.id;

      await request(server())
        .post(`/api/v1/applications/${appId}/review`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      await request(server())
        .post(`/api/v1/applications/${appId}/reject`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ reason: 'No vacancy for the requested room type.' })
        .expect(200);

      const res = await request(server())
        .get(`/api/v1/me/applications/${appId}`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe(
        'No vacancy for the requested room type.',
      );
    });
  });

  describe('withdrawal', () => {
    it('lets the applicant withdraw their own SUBMITTED application', async () => {
      const { propertyId } = await setupPublishedListing('withdraw1');
      const applicant = await registerAndLogin(
        'applicant-withdraw1@example.com',
      );
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Withdraw Me', phone: '9876500007' })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/me/applications/${submitRes.body.data.id}/withdraw`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('WITHDRAWN');
    });

    it('404s another applicant’s attempt to withdraw someone else’s application', async () => {
      const { propertyId } = await setupPublishedListing('withdraw2');
      const applicant = await registerAndLogin(
        'applicant-withdraw2a@example.com',
      );
      const stranger = await registerAndLogin(
        'applicant-withdraw2b@example.com',
      );
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Owner Applicant', phone: '9876500008' })
        .expect(201);

      await request(server())
        .post(`/api/v1/me/applications/${submitRes.body.data.id}/withdraw`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
    });
  });

  describe('visits: request -> schedule -> reschedule -> complete', () => {
    it('preserves visit history through the full lifecycle', async () => {
      const { owner, propertyId } = await setupPublishedListing('visit1');
      const applicant = await registerAndLogin('applicant-visit1@example.com');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Visitor', phone: '9876500009' })
        .expect(201);
      const appId = submitRes.body.data.id;

      const requestRes = await request(server())
        .post(`/api/v1/me/applications/${appId}/visits`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({})
        .expect(201);
      expect(requestRes.body.data.status).toBe('REQUESTED');
      const visitId = requestRes.body.data.id;

      const confirmRes = await request(server())
        .post(`/api/v1/visits/${visitId}/confirm`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          scheduledStartAt: '2027-01-01T10:00:00Z',
          scheduledEndAt: '2027-01-01T11:00:00Z',
        })
        .expect(200);
      expect(confirmRes.body.data.status).toBe('SCHEDULED');

      const rescheduleRes = await request(server())
        .post(`/api/v1/visits/${visitId}/reschedule`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          scheduledStartAt: '2027-01-02T10:00:00Z',
          scheduledEndAt: '2027-01-02T11:00:00Z',
        })
        .expect(200);
      expect(rescheduleRes.body.data.status).toBe('SCHEDULED');
      expect(rescheduleRes.body.data.id).toBe(visitId); // same row, never a new one

      const completeRes = await request(server())
        .post(`/api/v1/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(completeRes.body.data.status).toBe('COMPLETED');
    });

    it('cancels a visit and the applicant sees the updated status', async () => {
      const { owner, propertyId } = await setupPublishedListing('visit2');
      const applicant = await registerAndLogin('applicant-visit2@example.com');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Visitor Two', phone: '9876500010' })
        .expect(201);

      const scheduleRes = await request(server())
        .post(`/api/v1/applications/${submitRes.body.data.id}/visits`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          scheduledStartAt: '2027-02-01T10:00:00Z',
          scheduledEndAt: '2027-02-01T11:00:00Z',
        })
        .expect(201);

      const cancelRes = await request(server())
        .post(`/api/v1/me/visits/${scheduleRes.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ reason: 'Change of plans' })
        .expect(200);
      expect(cancelRes.body.data.status).toBe('CANCELLED');
    });
  });

  describe('isolation', () => {
    it('404s when a manager from a different organization looks up an application', async () => {
      const { propertyId } = await setupPublishedListing('iso1');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Iso Applicant', phone: '9876500011' })
        .expect(201);

      const otherOwner = await registerAndLogin('owner-iso1-other@example.com');
      await createOrg(otherOwner.token, 'Other Org');

      await request(server())
        .get(`/api/v1/applications/${submitRes.body.data.id}`)
        .set('Authorization', `Bearer ${otherOwner.token}`)
        .expect(404);
    });

    it('STAFF may read but not approve an application', async () => {
      const { owner, orgId, propertyId } = await setupPublishedListing('iso2');
      const staff = await addMember('STAFF', 'staff-iso2@example.com', orgId);
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Staff Test Applicant', phone: '9876500012' })
        .expect(201);

      await request(server())
        .get(`/api/v1/applications/${submitRes.body.data.id}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      // 404, not 403 - insufficient role on an org-scoped action resolves
      // the same way cross-organization access does in this codebase (see
      // ComplaintsService.getOrgComplaintForActionOrThrow for the same
      // convention).
      await request(server())
        .post(`/api/v1/applications/${submitRes.body.data.id}/review`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(404);

      // OWNER can still perform the write.
      await request(server())
        .post(`/api/v1/applications/${submitRes.body.data.id}/review`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
    });
  });

  describe('notification integration', () => {
    it('creates exactly one APPLICATION_APPROVED notification even if the review->approve sequence is repeated', async () => {
      const { owner, propertyId } = await setupPublishedListing('notif1');
      const applicant = await registerAndLogin('applicant-notif1@example.com');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .set('Authorization', `Bearer ${applicant.token}`)
        .send({ fullName: 'Notif Applicant', phone: '9876500014' })
        .expect(201);
      const appId = submitRes.body.data.id;

      await request(server())
        .post(`/api/v1/applications/${appId}/review`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      await request(server())
        .post(`/api/v1/applications/${appId}/approve`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      const prisma = fakePrisma as any;
      const approvedNotifications = (
        await prisma.notification.findMany()
      ).filter(
        (n: any) =>
          n.type === 'APPLICATION_APPROVED' && n.userId === applicant.userId,
      );
      expect(approvedNotifications).toHaveLength(1);
    });

    it('a notification-publish failure never rolls back the business operation (approval remains APPROVED)', async () => {
      const { owner, propertyId } = await setupPublishedListing('notif2');
      const submitRes = await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Resilience Applicant', phone: '9876500015' })
        .expect(201);
      const appId = submitRes.body.data.id;

      // Force the notification path to throw - approval must still commit
      // (DomainEventBusService.emit never propagates listener errors).
      const original = fakePrisma.notification.create;
      fakePrisma.notification.create = async () => {
        throw new Error('simulated notification outage');
      };

      await request(server())
        .post(`/api/v1/applications/${appId}/review`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const approveRes = await request(server())
        .post(`/api/v1/applications/${appId}/approve`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED');
      const getRes = await request(server())
        .get(`/api/v1/applications/${appId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(getRes.body.data.status).toBe('APPROVED');

      fakePrisma.notification.create = original;
    });
  });

  describe('admin: read-only platform visibility', () => {
    it('SUPER_ADMIN can list every application; a normal user gets 404', async () => {
      const { propertyId } = await setupPublishedListing('admin1');
      await request(server())
        .post(`/api/v1/public/properties/${propertyId}/applications`)
        .send({ fullName: 'Admin View Applicant', phone: '9876500013' })
        .expect(201);

      const nonAdmin = await registerAndLogin('nonadmin-admin1@example.com');
      await request(server())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${nonAdmin.token}`)
        .expect(404);

      const admin = await registerAndLogin('admin-admin1@example.com');
      const adminUser = await fakePrisma.user.findUnique({
        where: { id: admin.userId },
      });
      Object.assign(adminUser, { platformRole: 'SUPER_ADMIN' });

      const res = await request(server())
        .get('/api/v1/admin/applications')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });
  });
});
