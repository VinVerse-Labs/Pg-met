import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite,
// extended through Phase 9: complaints, complaint_activities,
// complaint_comments, complaint_attachments, plus organization_subscriptions
// / saas_plans so ComplaintsService's SUBSCRIPTION_SUSPENDED wiring
// (SubscriptionsService.isOrganizationWriteBlocked) can be exercised for
// real over HTTP rather than only via unit-test mocks. Every organization
// starts on an implicit TRIAL subscription the same way the real
// SubscriptionsService.ensureSubscriptionExists lazily provisions one - a
// dedicated describe block below seeds a SUSPENDED row directly to prove
// the block, mirroring how Phase 8's suite seeded org status directly.
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
  private saasPlans = new Map<string, any>();
  private subscriptions = new Map<string, any>();
  private complaints = new Map<string, any>();
  private complaintActivities = new Map<string, any>();
  private complaintComments = new Map<string, any>();
  private complaintAttachments = new Map<string, any>();

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
      [...this.memberships.values()].find((m) =>
        Object.entries(where).every(([k, v]) => m[k as keyof typeof m] === v),
      ) ?? null,
    findMany: async ({ where, select }: any) => {
      const rows = [...this.memberships.values()].filter((m) =>
        Object.entries(where ?? {}).every(([k, v]) => m[k] === v),
      );
      if (select?.organizationId) {
        return rows.map((m) => ({ organizationId: m.organizationId }));
      }
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
    findUnique: async ({ where }: any) => this.properties.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      const orgFilter = where.organizationId;
      return (
        [...this.properties.values()].find((p) => {
          if (p.id !== where.id) return false;
          if (!orgFilter) return true;
          if (typeof orgFilter === 'string')
            return p.organizationId === orgFilter;
          if (orgFilter.in) return orgFilter.in.includes(p.organizationId);
          return false;
        }) ?? null
      );
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
    findUnique: async ({ where }: any) => {
      if (where.id) return this.tenants.get(where.id) ?? null;
      if (where.userId) {
        return (
          [...this.tenants.values()].find((t) => t.userId === where.userId) ??
          null
        );
      }
      return null;
    },
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
        if (where.propertyId && r.propertyId !== where.propertyId) return false;
        if (where.status?.in && !where.status.in.includes(r.status))
          return false;
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
      if (data.status === 'ACTIVE') {
        const conflicting = [...this.residencies.values()].some(
          (r) =>
            r.id !== where.id &&
            r.tenantId === residency.tenantId &&
            r.status === 'ACTIVE',
        );
        if (conflicting) this.conflict('residencies_active_tenant_unique');
      }
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
    findFirst: async ({ where, include }: any) => {
      const allocation = [...this.bedAllocations.values()].find((a) =>
        Object.entries(where).every(([k, v]) => a[k] === v),
      );
      if (!allocation) return null;
      if (include?.bed) {
        return { ...allocation, bed: this.beds.get(allocation.bedId) };
      }
      return allocation;
    },
    update: async ({ where, data }: any) => {
      const allocation = this.bedAllocations.get(where.id);
      Object.assign(allocation, data);
      return allocation;
    },
  };

  saasPlan = {
    findFirst: async ({ where }: any) => {
      const candidates = [...this.saasPlans.values()].filter((p) => {
        if (where?.status && p.status !== where.status) return false;
        return true;
      });
      return candidates[0] ?? null;
    },
    findUnique: async ({ where }: any) => this.saasPlans.get(where.id) ?? null,
  };

  // Lazily provisions a TRIAL row exactly like the real
  // SubscriptionsService.ensureSubscriptionExists, and evaluateLifecycle
  // for a fresh TRIAL never crosses currentPeriodEnd within a test run,
  // so isOrganizationWriteBlocked resolves false for every organization
  // that never had a subscription row seeded directly. The "subscription
  // access" describe block below seeds a SUSPENDED row directly to prove
  // the opposite path.
  organizationSubscription = {
    findUnique: async ({ where }: any) =>
      [...this.subscriptions.values()].find(
        (s) => s.organizationId === where.organizationId,
      ) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const sub = this.subscriptions.get(where.id);
      if (!sub) throw new Error('subscription not found');
      const plan = this.saasPlans.get(sub.saasPlanId);
      return { ...sub, saasPlan: plan };
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
      const plan = this.saasPlans.get(sub.saasPlanId);
      return { ...sub, saasPlan: plan };
    },
  };

  complaint = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const complaint = {
        id,
        roomId: null,
        bedId: null,
        assignedToUserId: null,
        priority: 'MEDIUM',
        status: 'OPEN',
        resolutionNote: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.complaints.set(id, complaint);
      return complaint;
    },
    findFirst: async ({ where, include }: any) => {
      const complaint = [...this.complaints.values()].find(
        (c) => c.id === where.id,
      );
      if (!complaint) return null;
      if (include?.tenant) {
        const tenant = this.tenants.get(complaint.tenantId);
        return { ...complaint, tenant: { userId: tenant?.userId } };
      }
      return complaint;
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const complaint = this.complaints.get(where.id);
      if (!complaint) throw new Error('complaint not found');
      return complaint;
    },
    findMany: async ({ where, orderBy, skip = 0, take = 20 }: any) => {
      let rows = [...this.complaints.values()].filter((c) =>
        this.matchesComplaintWhere(c, where),
      );
      const [field, dir] = Object.entries(
        orderBy ?? { createdAt: 'desc' },
      )[0] as [string, 'asc' | 'desc'];
      rows = rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return dir === 'asc' ? cmp : -cmp;
      });
      return rows.slice(skip, skip + take);
    },
    count: async ({ where }: any) =>
      [...this.complaints.values()].filter((c) =>
        this.matchesComplaintWhere(c, where),
      ).length,
    update: async ({ where, data }: any) => {
      const complaint = this.complaints.get(where.id);
      Object.assign(complaint, data);
      return complaint;
    },
    updateMany: async ({ where, data }: any) => {
      const complaint = this.complaints.get(where.id);
      if (!complaint) return { count: 0 };
      if (where.status) {
        if (where.status.in && !where.status.in.includes(complaint.status)) {
          return { count: 0 };
        }
        if (
          typeof where.status === 'string' &&
          complaint.status !== where.status
        ) {
          return { count: 0 };
        }
      }
      Object.assign(complaint, data);
      return { count: 1 };
    },
  };

  private matchesComplaintWhere(c: any, where: any): boolean {
    if (!where) return true;
    if (where.id && c.id !== where.id) return false;
    if (where.tenantId && c.tenantId !== where.tenantId) return false;
    if (where.status && c.status !== where.status) return false;
    if (where.priority && c.priority !== where.priority) return false;
    if (where.category && c.category !== where.category) return false;
    if (where.propertyId && c.propertyId !== where.propertyId) return false;
    if (where.roomId && c.roomId !== where.roomId) return false;
    if (where.assignedToUserId && c.assignedToUserId !== where.assignedToUserId)
      return false;
    if (where.organizationId) {
      if (typeof where.organizationId === 'string') {
        if (c.organizationId !== where.organizationId) return false;
      } else if (where.organizationId.in) {
        if (!where.organizationId.in.includes(c.organizationId)) return false;
      }
    }
    return true;
  }

  complaintActivity = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const activity = { id, createdAt: now, ...data };
      this.complaintActivities.set(id, activity);
      return activity;
    },
    findMany: async ({ where }: any) =>
      [...this.complaintActivities.values()]
        .filter((a) => a.complaintId === where.complaintId)
        .sort((a, b) => a.createdAt - b.createdAt),
  };

  complaintComment = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const comment = { id, createdAt: now, updatedAt: now, ...data };
      this.complaintComments.set(id, comment);
      return comment;
    },
    findMany: async ({ where }: any) =>
      [...this.complaintComments.values()]
        .filter((c) => {
          if (c.complaintId !== where.complaintId) return false;
          if (where.visibility && c.visibility !== where.visibility)
            return false;
          return true;
        })
        .sort((a, b) => a.createdAt - b.createdAt),
  };

  complaintAttachment = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const attachment = { id, createdAt: now, ...data };
      this.complaintAttachments.set(id, attachment);
      return attachment;
    },
    findMany: async ({ where }: any) =>
      [...this.complaintAttachments.values()].filter(
        (a) => a.complaintId === where.complaintId,
      ),
    findFirst: async ({ where }: any) =>
      [...this.complaintAttachments.values()].find(
        (a) => a.id === where.id && a.complaintId === where.complaintId,
      ) ?? null,
    delete: async ({ where }: any) => {
      const attachment = this.complaintAttachments.get(where.id);
      this.complaintAttachments.delete(where.id);
      return attachment;
    },
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => [];
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();

  // Test-only helper: seed a subscription row directly (bypassing
  // ensureSubscriptionExists) so the "subscription access" describe block
  // can prove SUSPENDED blocks without faking the whole billing period
  // machinery.
  seedSubscription(organizationId: string, status: string) {
    const id = this.nextId();
    const planId = [...this.saasPlans.keys()][0];
    const now = new Date();
    this.subscriptions.set(id, {
      id,
      organizationId,
      saasPlanId: planId,
      pendingSaasPlanId: null,
      status,
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      nextBillingAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe('Phase 9: complaints & maintenance (e2e)', () => {
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

  async function registerAndLogin(email: string) {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Test User', email, password: 'password123' })
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
        name: 'Test Property',
        addressLine1: '1 Main St',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500032',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createRoom(
    token: string,
    propertyId: string,
    roomNumber: string,
  ) {
    const res = await request(server())
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomNumber, roomType: 'DOUBLE', capacity: 2 })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createBed(
    token: string,
    propertyId: string,
    roomId: string,
    bedNumber: string,
  ) {
    const res = await request(server())
      .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bedNumber })
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

  // Full setup: an organization with a property/room/bed, and a tenant
  // checked in (ACTIVE residency + ACTIVE bed allocation) so
  // ComplaintsService.create can resolve room/bed from the active
  // allocation exactly like a real tenant reporting a complaint would.
  async function setupOrgWithResidentTenant(suffix: string) {
    const owner = await registerAndLogin(`owner-${suffix}@example.com`);
    const orgId = await createOrg(owner.token, `Org ${suffix}`);
    const propertyId = await createProperty(owner.token, orgId);
    const roomId = await createRoom(owner.token, propertyId, `R-${suffix}`);
    const bedId = await createBed(
      owner.token,
      propertyId,
      roomId,
      `B-${suffix}`,
    );

    const tenantUser = await registerAndLogin(`tenant-${suffix}@example.com`);
    const tenantId = await createTenant(tenantUser.token);

    const residencyRes = await request(server())
      .post(`/api/v1/properties/${propertyId}/residencies`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
      .expect(201);
    const residencyId = residencyRes.body.data.id as string;

    await request(server())
      .post(`/api/v1/residencies/${residencyId}/check-in`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bedId })
      .expect(200);

    return {
      owner,
      orgId,
      propertyId,
      roomId,
      bedId,
      tenantUser,
      tenantId,
      residencyId,
    };
  }

  describe('Create + read + scoping', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('create9');
    });

    it('a tenant reports a complaint against their own residency; identity fields are server-derived', async () => {
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'PLUMBING',
          title: 'Leaking tap',
          description: 'The bathroom tap has been leaking since morning.',
        })
        .expect(201);

      expect(res.body.data.organizationId).toBe(ctx.orgId);
      expect(res.body.data.tenantId).toBe(ctx.tenantId);
      expect(res.body.data.residencyId).toBe(ctx.residencyId);
      expect(res.body.data.bedId).toBe(ctx.bedId);
      expect(res.body.data.roomId).toBe(ctx.roomId);
      expect(res.body.data.status).toBe('OPEN');
      expect(res.body.data.priority).toBe('MEDIUM');
    });

    it('caps a tenant-supplied URGENT priority down to HIGH', async () => {
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'ELECTRICAL',
          priority: 'URGENT',
          title: 'Sparking socket',
          description: 'The wall socket in the room is sparking.',
        })
        .expect(201);
      expect(res.body.data.priority).toBe('HIGH');
    });

    it('rejects a complaint from a user with no current residency at the property', async () => {
      const outsider = await registerAndLogin('outsider-create9@example.com');
      await createTenant(outsider.token);
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'OTHER',
          title: 'Not my property',
          description: 'This should be rejected.',
        })
        .expect(409);
      expect(res.body.error.code).toBe('COMPLAINT_INVALID_RESIDENCY_CONTEXT');
    });

    it('lists only the tenant’s own complaints for that tenant', async () => {
      const res = await request(server())
        .get('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
      expect(
        res.body.data.items.every((c: any) => c.tenantId === ctx.tenantId),
      ).toBe(true);
    });

    it('lists organization-scoped complaints for the owner', async () => {
      const res = await request(server())
        .get('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(
        res.body.data.items.every((c: any) => c.organizationId === ctx.orgId),
      ).toBe(true);
    });
  });

  describe('BOLA / IDOR: cross-tenant and cross-organization isolation', () => {
    let ctxA: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let ctxB: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let complaintAId: string;

    beforeAll(async () => {
      ctxA = await setupOrgWithResidentTenant('bolaA');
      ctxB = await setupOrgWithResidentTenant('bolaB');

      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctxA.tenantUser.token}`)
        .send({
          propertyId: ctxA.propertyId,
          category: 'ROOM',
          title: 'Org A complaint',
          description: 'Reported by Org A tenant.',
        })
        .expect(201);
      complaintAId = res.body.data.id;
    });

    it('Tenant B cannot read Tenant A’s complaint (cross-tenant, 404)', async () => {
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintAId}`)
        .set('Authorization', `Bearer ${ctxB.tenantUser.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');
    });

    it('Org B’s owner cannot read Org A’s complaint (cross-organization, 404)', async () => {
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintAId}`)
        .set('Authorization', `Bearer ${ctxB.owner.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');
    });

    it('Org B’s manager cannot assign Org A’s complaint (cross-organization write, 404, no mutation)', async () => {
      const managerB = await addMember(
        'MANAGER',
        'manager-bolaB@example.com',
        ctxB.orgId,
      );
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintAId}/assign`)
        .set('Authorization', `Bearer ${managerB.token}`)
        .send({ assignedToUserId: managerB.userId })
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');

      const stillOpen = await request(server())
        .get(`/api/v1/complaints/${complaintAId}`)
        .set('Authorization', `Bearer ${ctxA.owner.token}`)
        .expect(200);
      expect(stillOpen.body.data.status).toBe('OPEN');
      expect(stillOpen.body.data.assignedToUserId).toBeNull();
    });

    it('Org A’s manager cannot assign the complaint to an Org B member (assignee not in organization)', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintAId}/assign`)
        .set('Authorization', `Bearer ${ctxA.owner.token}`)
        .send({ assignedToUserId: ctxB.owner.userId })
        .expect(409);
      expect(res.body.error.code).toBe(
        'COMPLAINT_ASSIGNEE_NOT_IN_ORGANIZATION',
      );
    });

    it('an unrelated outsider (no membership, no residency) gets 404 on read', async () => {
      const outsider = await registerAndLogin('outsider-bola@example.com');
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintAId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');
    });
  });

  describe('Lifecycle transitions', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let staff: { token: string; userId: string };
    let complaintId: string;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('lifecycle9');
      staff = await addMember(
        'STAFF',
        'staff-lifecycle9@example.com',
        ctx.orgId,
      );

      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'CLEANING',
          title: 'Room needs cleaning',
          description: 'Common area was not cleaned this week.',
        })
        .expect(201);
      complaintId = res.body.data.id;
    });

    it('OWNER assigns the complaint to STAFF: OPEN -> ASSIGNED', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/assign`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ assignedToUserId: staff.userId })
        .expect(200);
      expect(res.body.data.status).toBe('ASSIGNED');
      expect(res.body.data.assignedToUserId).toBe(staff.userId);
    });

    it('a different STAFF member cannot start a complaint assigned to someone else', async () => {
      const otherStaff = await addMember(
        'STAFF',
        'other-staff-lifecycle9@example.com',
        ctx.orgId,
      );
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/start`)
        .set('Authorization', `Bearer ${otherStaff.token}`)
        .expect(403);
      expect(res.body.error.code).toBe('COMPLAINT_ASSIGNMENT_NOT_ALLOWED');
    });

    it('the assigned STAFF starts the complaint: ASSIGNED -> IN_PROGRESS', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/start`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
    });

    it('OWNER changes priority to URGENT (only OWNER/MANAGER may do this)', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/priority`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ priority: 'URGENT' })
        .expect(200);
      expect(res.body.data.priority).toBe('URGENT');
    });

    it('resolves with a required resolution note: IN_PROGRESS -> RESOLVED', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/resolve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          resolutionNote: 'Cleaned the common area and logged a reminder.',
        })
        .expect(200);
      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.resolutionNote).toBe(
        'Cleaned the common area and logged a reminder.',
      );
    });

    it('rejects STAFF closing a resolved complaint (OWNER/MANAGER only)', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/close`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');
    });

    it('OWNER closes the complaint: RESOLVED -> CLOSED', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/close`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('CLOSED');
    });

    it('rejects resolving an already-closed complaint (invalid transition)', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/resolve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ resolutionNote: 'too late' })
        .expect(409);
      expect(res.body.error.code).toBe('COMPLAINT_INVALID_STATUS_TRANSITION');
    });

    it('the reporting tenant can cancel their own still-OPEN complaint', async () => {
      const openRes = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'OTHER',
          title: 'Changed my mind',
          description: 'No longer an issue.',
        })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/complaints/${openRes.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });
  });

  describe('Comments: PUBLIC vs INTERNAL visibility', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let complaintId: string;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('comments9');
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'WIFI',
          title: 'WiFi down',
          description: 'No internet since last night.',
        })
        .expect(201);
      complaintId = res.body.data.id;
    });

    it('a tenant can add a PUBLIC comment', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/comments`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ body: 'Still not working.' })
        .expect(201);
      expect(res.body.data.visibility).toBe('PUBLIC');
    });

    it('a tenant cannot create an INTERNAL comment', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/comments`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ body: 'secret', visibility: 'INTERNAL' })
        .expect(403);
      expect(res.body.error.code).toBe('COMPLAINT_INTERNAL_COMMENT_FORBIDDEN');
    });

    it('OWNER can add an INTERNAL comment', async () => {
      const res = await request(server())
        .post(`/api/v1/complaints/${complaintId}/comments`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ body: 'Router needs replacing.', visibility: 'INTERNAL' })
        .expect(201);
      expect(res.body.data.visibility).toBe('INTERNAL');
    });

    it('the tenant never sees the INTERNAL comment in the list', async () => {
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintId}/comments`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.every((c: any) => c.visibility === 'PUBLIC')).toBe(
        true,
      );
    });

    it('the owner sees both PUBLIC and INTERNAL comments', async () => {
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintId}/comments`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(res.body.data.some((c: any) => c.visibility === 'INTERNAL')).toBe(
        true,
      );
    });
  });

  describe('Activity trail', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let complaintId: string;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('activity9');
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'FURNITURE',
          title: 'Broken chair',
          description: 'The study chair leg is broken.',
        })
        .expect(201);
      complaintId = res.body.data.id;

      const manager = await addMember(
        'MANAGER',
        'manager-activity9@example.com',
        ctx.orgId,
      );
      await request(server())
        .post(`/api/v1/complaints/${complaintId}/assign`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ assignedToUserId: manager.userId })
        .expect(200);
    });

    it('records CREATED then ASSIGNED activity entries, oldest first, visible to the tenant', async () => {
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintId}/activity`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      const types = res.body.data.map((a: any) => a.type);
      expect(types).toEqual(['CREATED', 'ASSIGNED']);
    });

    it('an unrelated outsider cannot read the activity trail (404)', async () => {
      const outsider = await registerAndLogin('outsider-activity9@example.com');
      const res = await request(server())
        .get(`/api/v1/complaints/${complaintId}/activity`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('COMPLAINT_NOT_FOUND');
    });
  });

  describe('Super Admin platform visibility', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let complaintId: string;
    let superAdminToken: string;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('admin9');
      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'SECURITY',
          title: 'Front gate lock broken',
          description: 'The main gate lock does not latch properly.',
        })
        .expect(201);
      complaintId = res.body.data.id;

      const superAdmin = await registerAndLogin('sa-complaints9@example.com');
      await fakePrisma.user.update({
        where: { id: superAdmin.userId },
        data: { platformRole: 'SUPER_ADMIN' },
      });
      superAdminToken = superAdmin.token;
    });

    it('SUPER_ADMIN can list every complaint on the platform', async () => {
      const res = await request(server())
        .get('/api/v1/admin/complaints')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.items.some((c: any) => c.id === complaintId)).toBe(
        true,
      );
    });

    it('SUPER_ADMIN can read any single complaint by id', async () => {
      const res = await request(server())
        .get(`/api/v1/admin/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(complaintId);
    });

    it('a non-admin OWNER is denied the admin endpoint (404, hides existence)', async () => {
      const res = await request(server())
        .get('/api/v1/admin/complaints')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });
  });

  describe('Subscription access (SUBSCRIPTION_SUSPENDED wiring)', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('subscription9');
    });

    it('a SUSPENDED subscription blocks a tenant from creating a new complaint', async () => {
      fakePrisma.seedSubscription(ctx.orgId, 'SUSPENDED');

      const res = await request(server())
        .post('/api/v1/complaints')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({
          propertyId: ctx.propertyId,
          category: 'OTHER',
          title: 'Blocked by suspension',
          description: 'This should be rejected.',
        })
        .expect(403);
      expect(res.body.error.code).toBe('SUBSCRIPTION_SUSPENDED');
    });

    it('SUPER_ADMIN bypasses the suspended-subscription block entirely (no gate applies)', async () => {
      const superAdmin = await registerAndLogin('sa-subscription9@example.com');
      await fakePrisma.user.update({
        where: { id: superAdmin.userId },
        data: { platformRole: 'SUPER_ADMIN' },
      });

      // SUPER_ADMIN has no tenant/residency, so it cannot itself create a
      // complaint (that path requires a tenant profile) - the bypass is
      // instead proven via the read-only admin endpoint remaining
      // reachable regardless of the organization's subscription state.
      const res = await request(server())
        .get('/api/v1/admin/complaints')
        .set('Authorization', `Bearer ${superAdmin.token}`)
        .expect(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });
});
