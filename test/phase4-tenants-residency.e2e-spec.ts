import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// An in-memory stand-in for PrismaService covering the full chain: users,
// refresh_tokens, organizations, organization_memberships, properties,
// rooms, beds, tenants, residencies, bed_allocations. Same pattern as
// test/phase2-*.e2e-spec.ts and test/phase3-*.e2e-spec.ts - proves the
// real HTTP stack end to end without a running Postgres instance.
//
// This fake ALSO enforces the two partial unique indexes
// (residencies_active_tenant_unique, bed_allocations_active_bed_unique)
// for sequential requests, so the business-logic-correctness tests below
// (duplicate active residency, double allocation) exercise the same
// conflict-translation path ResidenciesService.checkIn uses for a real
// concurrent race. A genuine concurrent-request race (two simultaneous
// requests truly overlapping in time) cannot be demonstrated against an
// in-memory single-threaded fake - that is proven separately against the
// real Postgres instance (see the Phase 4 final report's manual
// verification section).
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
          if (!orgFilter) return true;
          if (typeof orgFilter === 'string')
            return p.organizationId === orgFilter;
          if (orgFilter.in) return orgFilter.in.includes(p.organizationId);
          return false;
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
    // Phase 13: RoomsService.findAccessible (room list with occupancy).
    findMany: async ({ where }: any) =>
      [...this.rooms.values()].filter((r) => r.propertyId === where.propertyId),
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
          const orgFilter = where.property.organizationId;
          if (!property) return false;
          if (typeof orgFilter === 'string')
            return property.organizationId === orgFilter;
          if (orgFilter?.in)
            return orgFilter.in.includes(property.organizationId);
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
    // Phase 13: supports RoomsService.occupancyByRoom's
    // {roomId: {in}, status: {not}} shape as well as the original {roomId}.
    findMany: async ({ where }: any) =>
      [...this.beds.values()].filter((b) => {
        if (typeof where.roomId === 'string' && b.roomId !== where.roomId)
          return false;
        if (where.roomId?.in && !where.roomId.in.includes(b.roomId))
          return false;
        if (where.status?.not && b.status === where.status.not) return false;
        return true;
      }),
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
    // Supports both BedsService's simple {id, roomId} lookup and
    // ResidenciesService.checkIn's {id, room: {propertyId}} + nested
    // include of room.property - the exact shapes the real services use.
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
    findMany: async ({ where }: any) =>
      [...this.residencies.values()].filter((r) => {
        if (where.propertyId && r.propertyId !== where.propertyId) return false;
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.property?.organizationId) {
          const property = this.properties.get(r.propertyId);
          const orgFilter = where.property.organizationId;
          if (!property) return false;
          if (orgFilter.in && !orgFilter.in.includes(property.organizationId)) {
            return false;
          }
        }
        return true;
      }),
    findFirst: async ({ where, include }: any) => {
      const residency = [...this.residencies.values()].find((r) => {
        if (where.id && r.id !== where.id) return false;
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.status?.in && !where.status.in.includes(r.status))
          return false;
        if (where.property) {
          const property = this.properties.get(r.propertyId);
          const orgFilter = where.property.organizationId;
          if (!property) return false;
          if (
            orgFilter?.in &&
            !orgFilter.in.includes(property.organizationId)
          ) {
            return false;
          }
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
    // Phase 13: supports {status, bedId: {in}} (occupancy/occupants) and
    // {bed: {roomId}} (room history), plus the residency -> tenant -> user
    // and bed includes those queries use. No rent plans exist in this suite.
    findMany: async ({ where, include, orderBy, take }: any) => {
      let rows = [...this.bedAllocations.values()].filter((a) => {
        if (where.status && a.status !== where.status) return false;
        if (where.bedId?.in && !where.bedId.in.includes(a.bedId)) return false;
        if (
          where.bed?.roomId &&
          this.beds.get(a.bedId)?.roomId !== where.bed.roomId
        )
          return false;
        return true;
      });
      if (orderBy?.startDate === 'desc') {
        rows = rows.sort(
          (x, y) => +new Date(y.startDate) - +new Date(x.startDate),
        );
      }
      if (take) rows = rows.slice(0, take);
      if (!include) return rows.map((a) => ({ bedId: a.bedId }));
      return rows.map((a) => {
        const residency = this.residencies.get(a.residencyId);
        const tenant = this.tenants.get(residency.tenantId);
        const user = this.users.get(tenant.userId);
        return {
          ...a,
          bed: { bedNumber: this.beds.get(a.bedId)?.bedNumber },
          residency: {
            id: residency.id,
            tenantId: residency.tenantId,
            tenant: { user: { name: user.name, phone: user.phone ?? null } },
            rentPlans: [],
          },
        };
      });
    },
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

  // Phase 10: ResidenciesService.checkOut also calls
  // FoodSubscriptionsService.cancelForCheckout(tx, residencyId) inside its
  // own transaction - a real service (not mocked here), so it needs a
  // minimal tenantFoodSubscription stub even though this suite never
  // creates a food subscription itself; updateMany against an empty map
  // is always a safe { count: 0 } no-op.
  tenantFoodSubscription = {
    updateMany: async () => ({ count: 0 }),
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => [];
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

describe('Phase 4: tenants + residency + bed allocation (e2e)', () => {
  let app: INestApplication;

  // This suite's setup alone (many users/orgs/properties/rooms/beds across
  // several `beforeAll` blocks sharing one app instance, several dozen
  // /auth/register calls) issues far more requests than AuthController's
  // stricter 10/min @Throttle on /auth/register|/login allows. Neither
  // `.overrideProvider(APP_GUARD)` nor `.overrideGuard(ThrottlerGuard)`
  // reliably intercepts a guard registered as a global enhancer via
  // `{ provide: APP_GUARD, useClass: ThrottlerGuard }` in AppModule - Nest
  // wires global enhancers from the raw provider definition at module-scan
  // time, not a later container-level override. Patching the prototype
  // method directly is what actually reaches the real instance Nest
  // constructs. Disabled here since this suite tests
  // authorization/business logic, not rate limiting (nothing in the e2e
  // suite exercises throttling end-to-end regardless).
  let throttlerSpy: jest.SpyInstance;

  beforeAll(async () => {
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
    return {
      userId: res.body.data.user.id,
      accessToken: res.body.data.tokens.accessToken as string,
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
    capacity = 2,
  ) {
    const res = await request(server())
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomNumber, roomType: 'DOUBLE', capacity })
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

  describe('Tenant profile', () => {
    it('creates a tenant profile for the caller', async () => {
      const owner = await registerAndLogin('tenant1@example.com');
      const tenantId = await createTenant(owner.accessToken);
      expect(tenantId).toBeDefined();
    });

    it('rejects a second tenant profile for the same user', async () => {
      const user = await registerAndLogin('tenant2@example.com');
      await createTenant(user.accessToken);

      const res = await request(server())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it("hides an unrelated tenant's profile from a caller who shares no residency (BOLA)", async () => {
      const tenantUser = await registerAndLogin('tenant3@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      const outsider = await registerAndLogin('tenant3-outsider@example.com');
      const res = await request(server())
        .get(`/api/v1/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('lets an owner see a tenant once that tenant has a residency in their organization', async () => {
      const owner = await registerAndLogin('tenant4-owner@example.com');
      const orgId = await createOrg(owner.accessToken, 'Tenant Org');
      const propertyId = await createProperty(owner.accessToken, orgId);

      const tenantUser = await registerAndLogin('tenant4@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);

      const res = await request(server())
        .get(`/api/v1/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(tenantId);
    });
  });

  describe('Residency creation and validation', () => {
    let ownerToken: string;
    let orgId: string;
    let propertyId: string;

    beforeAll(async () => {
      const owner = await registerAndLogin('resowner@example.com');
      ownerToken = owner.accessToken;
      orgId = await createOrg(ownerToken, 'Residency Org');
      propertyId = await createProperty(ownerToken, orgId);
    });

    it('creates a residency in PENDING status', async () => {
      const tenantUser = await registerAndLogin('restenant1@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);

      expect(res.body.data.status).toBe('PENDING');
    });

    it('rejects an invalid date range', async () => {
      const tenantUser = await registerAndLogin('restenant2@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          tenantId,
          startDate: '2027-06-01T00:00:00.000Z',
          expectedEndDate: '2027-01-01T00:00:00.000Z',
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a nonexistent tenant', async () => {
      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId: randomUUID(), startDate: '2027-01-01T00:00:00.000Z' })
        .expect(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('rejects creating a residency at an archived property', async () => {
      const archivedProperty = await createProperty(ownerToken, orgId);
      await request(server())
        .delete(`/api/v1/properties/${archivedProperty}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const tenantUser = await registerAndLogin('restenant3@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      const res = await request(server())
        .post(`/api/v1/properties/${archivedProperty}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(409);
      expect(res.body.error.code).toBe('PROPERTY_NOT_ACTIVE');
    });

    it('allows multiple historical (non-overlapping) residencies for the same tenant, but rejects two simultaneously active/pending ones', async () => {
      const tenantUser = await registerAndLogin('restenant4@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);

      await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-02-01T00:00:00.000Z' })
        .expect(409);
      expect(res.body.error.code).toBe('TENANT_ALREADY_ALLOCATED');
    });

    it('rejects unauthenticated residency creation', async () => {
      await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .send({ tenantId: randomUUID(), startDate: '2027-01-01T00:00:00.000Z' })
        .expect(401);
    });
  });

  describe('Check-in / check-out lifecycle', () => {
    let ownerToken: string;
    let orgId: string;
    let propertyId: string;
    let roomId: string;
    let bedId: string;
    let tenantId: string;
    let residencyId: string;

    beforeAll(async () => {
      const owner = await registerAndLogin('lifecycleowner@example.com');
      ownerToken = owner.accessToken;
      orgId = await createOrg(ownerToken, 'Lifecycle Org');
      propertyId = await createProperty(ownerToken, orgId);
      roomId = await createRoom(ownerToken, propertyId, '101', 1);
      bedId = await createBed(ownerToken, propertyId, roomId, 'B1');

      const tenantUser = await registerAndLogin('lifecycletenant@example.com');
      tenantId = await createTenant(tenantUser.accessToken);

      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);
      residencyId = res.body.data.id;
    });

    it('rejects check-in with a bed from a different property', async () => {
      const otherPropertyId = await createProperty(ownerToken, orgId);
      const otherRoomId = await createRoom(
        ownerToken,
        otherPropertyId,
        '999',
        1,
      );
      const otherBedId = await createBed(
        ownerToken,
        otherPropertyId,
        otherRoomId,
        'X1',
      );

      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedId: otherBedId })
        .expect(404);
      expect(res.body.error.code).toBe('BED_NOT_FOUND');
    });

    it('checks in successfully', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedId })
        .expect(200);

      expect(res.body.data.residency.status).toBe('ACTIVE');
      expect(res.body.data.allocation.status).toBe('ACTIVE');
      expect(res.body.data.allocation.bedId).toBe(bedId);
    });

    it('rejects checking in the same residency twice (already ACTIVE)', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedId })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_RESIDENCY_STATE');
    });

    it('rejects a second resident checking into the same (now occupied) bed', async () => {
      const secondTenantUser = await registerAndLogin(
        'lifecycletenant2@example.com',
      );
      const secondTenantId = await createTenant(secondTenantUser.accessToken);
      const secondResRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          tenantId: secondTenantId,
          startDate: '2027-01-01T00:00:00.000Z',
        })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/residencies/${secondResRes.body.data.id}/check-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedId })
        .expect(409);
      expect(res.body.error.code).toBe('BED_ALREADY_OCCUPIED');
    });

    it('checks out successfully: ends the allocation and marks CHECKED_OUT, without deleting history', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-out`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.data.residency.status).toBe('CHECKED_OUT');
      expect(res.body.data.allocation.status).toBe('ENDED');

      // Historical allocation/residency remain readable, not deleted.
      const getRes = await request(server())
        .get(`/api/v1/residencies/${residencyId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(getRes.body.data.status).toBe('CHECKED_OUT');
    });

    it('rejects a double checkout', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-out`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_CHECKOUT');
    });

    it('the bed is available again for a new check-in after checkout', async () => {
      const newTenantUser = await registerAndLogin(
        'lifecycletenant3@example.com',
      );
      const newTenantId = await createTenant(newTenantUser.accessToken);
      const newResRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ tenantId: newTenantId, startDate: '2027-03-01T00:00:00.000Z' })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/residencies/${newResRes.body.data.id}/check-in`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedId })
        .expect(200);
      expect(res.body.data.allocation.bedId).toBe(bedId);
    });
  });

  describe('Phase 13: room details, occupancy, occupants and history', () => {
    let ownerToken: string;
    let propertyId: string;
    let roomId: string;
    let lowerBedId: string;
    let residencyId: string;
    const auth = () => ({ Authorization: `Bearer ${ownerToken}` });

    beforeAll(async () => {
      const owner = await registerAndLogin('p13owner@example.com');
      ownerToken = owner.accessToken;
      const orgId = await createOrg(ownerToken, 'Phase 13 Org');
      propertyId = await createProperty(ownerToken, orgId);

      const roomRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set(auth())
        .send({
          roomNumber: '101',
          roomType: 'TRIPLE',
          capacity: 3,
          floor: 1,
          pricePerBed: '7000',
          amenities: ['AC', 'WIFI', 'ATTACHED_WASHROOM'],
          imageUrl: 'https://images.example.com/room-101.jpg',
          description: 'Spacious room with good ventilation.',
        })
        .expect(201);
      roomId = roomRes.body.data.id;

      const lower = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
        .set(auth())
        .send({ bedNumber: 'L1', berth: 'LOWER' })
        .expect(201);
      lowerBedId = lower.body.data.id;
      await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
        .set(auth())
        .send({ bedNumber: 'U1', berth: 'UPPER' })
        .expect(201);

      const tenantUser = await registerAndLogin('p13tenant@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);
      const residency = await request(server())
        .post(`/api/v1/properties/${propertyId}/residencies`)
        .set(auth())
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);
      residencyId = residency.body.data.id;
      await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-in`)
        .set(auth())
        .send({ bedId: lowerBedId })
        .expect(200);
    });

    it('returns room details and exact per-room occupancy in the room list', async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms`)
        .set(auth())
        .expect(200);
      const room = res.body.data.find((r: any) => r.id === roomId);
      expect(room).toMatchObject({
        pricePerBed: '7000.00',
        currency: 'INR',
        amenities: ['AC', 'WIFI', 'ATTACHED_WASHROOM'],
        imageUrl: 'https://images.example.com/room-101.jpg',
        description: 'Spacious room with good ventilation.',
        occupancy: {
          totalBeds: 2,
          occupiedBeds: 1,
          vacantBeds: 1,
          blockedBeds: 0,
        },
      });
    });

    it('shows the current occupant on the occupied bed only, with berth', async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
        .set(auth())
        .expect(200);
      const lower = res.body.data.find((b: any) => b.bedNumber === 'L1');
      const upper = res.body.data.find((b: any) => b.bedNumber === 'U1');
      expect(lower.berth).toBe('LOWER');
      expect(lower.occupant).toMatchObject({
        residencyId,
        name: 'Test User',
        monthlyRent: null,
      });
      expect(upper.berth).toBe('UPPER');
      expect(upper.occupant).toBeNull();
    });

    it('lists the check-in in room history, and the check-out after it ends', async () => {
      const before = await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms/${roomId}/history`)
        .set(auth())
        .expect(200);
      expect(before.body.data).toEqual([
        expect.objectContaining({
          bedNumber: 'L1',
          residencyId,
          tenantName: 'Test User',
          status: 'ACTIVE',
          endDate: null,
        }),
      ]);

      await request(server())
        .post(`/api/v1/residencies/${residencyId}/check-out`)
        .set(auth())
        .send({})
        .expect(200);

      const after = await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms/${roomId}/history`)
        .set(auth())
        .expect(200);
      expect(after.body.data[0]).toMatchObject({ status: 'ENDED' });
      expect(after.body.data[0].endDate).not.toBeNull();

      const rooms = await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms`)
        .set(auth())
        .expect(200);
      expect(
        rooms.body.data.find((r: any) => r.id === roomId).occupancy,
      ).toMatchObject({ occupiedBeds: 0, vacantBeds: 2 });
    });

    it.each([
      [{ pricePerBed: 'abc' }],
      [{ pricePerBed: '100.555' }],
      [{ imageUrl: 'javascript:alert(1)' }],
      [{ amenities: ['SWIMMING_POOL'] }],
      [{ amenities: ['AC', 'AC'] }],
    ])('rejects invalid room details %o with 400', async (patch) => {
      await request(server())
        .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
        .set(auth())
        .send(patch)
        .expect(400);
    });

    it('404s room history for a user outside the organization', async () => {
      const outsider = await registerAndLogin('p13outsider@example.com');
      await request(server())
        .get(`/api/v1/properties/${propertyId}/rooms/${roomId}/history`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
    });
  });

  describe('Cross-organization security: Organization A vs Organization B', () => {
    let ownerAToken: string;
    let outsiderToken: string;
    let propertyAId: string;
    let residencyAId: string;
    let bedAId: string;

    beforeAll(async () => {
      const ownerA = await registerAndLogin('sec4ownerA@example.com');
      ownerAToken = ownerA.accessToken;
      const outsider = await registerAndLogin('sec4outsider@example.com');
      outsiderToken = outsider.accessToken;

      const orgAId = await createOrg(ownerAToken, 'Sec4 Org A');
      propertyAId = await createProperty(ownerAToken, orgAId);
      const roomAId = await createRoom(ownerAToken, propertyAId, '1', 1);
      bedAId = await createBed(ownerAToken, propertyAId, roomAId, 'B1');

      const tenantUser = await registerAndLogin('sec4tenant@example.com');
      const tenantId = await createTenant(tenantUser.accessToken);
      const resRes = await request(server())
        .post(`/api/v1/properties/${propertyAId}/residencies`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
        .expect(201);
      residencyAId = resRes.body.data.id;
    });

    it('User B cannot GET Residency A', async () => {
      const res = await request(server())
        .get(`/api/v1/residencies/${residencyAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });

    it('User B cannot PATCH Residency A', async () => {
      await request(server())
        .patch(`/api/v1/residencies/${residencyAId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ expectedEndDate: '2027-06-01T00:00:00.000Z' })
        .expect(404);
    });

    it('User B cannot check Residency A in', async () => {
      const res = await request(server())
        .post(`/api/v1/residencies/${residencyAId}/check-in`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ bedId: bedAId })
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });

    it('User B cannot check Residency A out', async () => {
      await request(server())
        .post(`/api/v1/residencies/${residencyAId}/check-out`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('User B cannot spoof organizationId by creating a residency directly under Property A', async () => {
      const res = await request(server())
        .post(`/api/v1/properties/${propertyAId}/residencies`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ tenantId: randomUUID(), startDate: '2027-01-01T00:00:00.000Z' })
        .expect(404);
      expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
    });

    it("User A's own residency still works normally", async () => {
      const res = await request(server())
        .get(`/api/v1/residencies/${residencyAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(residencyAId);
    });
  });
});
