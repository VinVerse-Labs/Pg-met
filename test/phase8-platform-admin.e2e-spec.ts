import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// A leaner FakePrisma than prior phases' - Phase 8's heavy aggregate
// endpoints (dashboard/revenue/occupancy, which lean on Prisma groupBy/
// $queryRaw) are proven against the real Postgres instance instead (see
// the Phase 8 final report) - faking groupBy/raw-SQL aggregation
// correctly would be a bigger, less trustworthy surface than just using
// the real database for that part, the same division of labor Phase 6/7
// used for their own concurrency proofs. This suite instead exercises
// the parts that are safe and valuable to fake: platform-admin
// authorization (the highest-risk part of this phase) and the simpler
// CRUD/audit-log paths.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private saasPlans = new Map<string, any>();
  private subscriptions = new Map<string, any>();
  private auditLogs = new Map<string, any>();

  constructor() {
    const id = randomUUID();
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
    findUnique: async ({ where, include }: any) => {
      const org = this.organizations.get(where.id);
      if (!org) return null;
      return this.attachOrgIncludes(org, include);
    },
    findMany: async ({ where, include }: any) => {
      let orgs = [...this.organizations.values()];
      if (where?.status) orgs = orgs.filter((o) => o.status === where.status);
      return orgs.map((o) => this.attachOrgIncludes(o, include));
    },
    count: async ({ where }: any) => {
      let orgs = [...this.organizations.values()];
      if (where?.status) orgs = orgs.filter((o) => o.status === where.status);
      return orgs.length;
    },
    updateMany: async ({ where, data }: any) => {
      const org = this.organizations.get(where.id);
      if (!org) return { count: 0 };
      if (where.status?.not && org.status === where.status.not)
        return { count: 0 };
      Object.assign(org, data);
      return { count: 1 };
    },
  };

  private attachOrgIncludes(org: any, include: any) {
    let result = org;
    if (include?.subscription) {
      const sub = [...this.subscriptions.values()].find(
        (s) => s.organizationId === org.id,
      );
      result = { ...result, subscription: sub ?? null };
    }
    if (include?._count?.select?.properties) {
      result = { ...result, _count: { properties: 0 } };
    }
    if (include?.memberships) {
      const memberships = [...this.memberships.values()].filter(
        (m) =>
          m.organizationId === org.id &&
          m.role === 'OWNER' &&
          m.status === 'ACTIVE',
      );
      result = {
        ...result,
        memberships: memberships.map((m) => ({
          ...m,
          user: this.users.get(m.userId),
        })),
      };
    }
    return result;
  }

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
    findMany: async ({ where }: any) =>
      [...this.memberships.values()].filter((m) =>
        Object.entries(where ?? {}).every(([k, v]) => m[k] === v),
      ),
  };

  saasPlan = {
    findMany: async () =>
      [...this.saasPlans.values()].sort((a, b) => b.createdAt - a.createdAt),
    findFirst: async ({ where }: any) => {
      const candidates = [...this.saasPlans.values()].filter((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.status && p.status !== where.status) return false;
        return true;
      });
      return candidates.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
    },
    findUnique: async ({ where }: any) => this.saasPlans.get(where.id) ?? null,
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const plan = {
        id,
        currency: 'INR',
        billingInterval: 'MONTHLY',
        status: 'ACTIVE',
        description: null,
        effectiveFrom: now,
        effectiveTo: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.saasPlans.set(id, plan);
      return plan;
    },
    update: async ({ where, data }: any) => {
      const plan = this.saasPlans.get(where.id);
      Object.assign(plan, data);
      return plan;
    },
  };

  // This suite never seeds properties/rooms/beds/residencies - these are
  // present only so findOrganizationDetail's capacity/occupancy counts
  // resolve to 0 rather than throwing. Full occupancy/capacity
  // aggregation is proven against real Postgres instead (see this file's
  // top comment).
  room = { count: async () => 0 };
  bed = { count: async () => 0 };
  residency = { findMany: async () => [], count: async () => 0 };
  tenant = { count: async () => 0 };
  property = { count: async () => 0, findMany: async () => [] };

  auditLog = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const log = {
        id,
        metadata: null,
        organizationId: null,
        createdAt: now,
        ...data,
      };
      this.auditLogs.set(id, log);
      return log;
    },
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      let rows = [...this.auditLogs.values()].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      if (where?.action)
        rows = rows.filter((r) => r.action === where.action.equals);
      if (where?.organizationId)
        rows = rows.filter((r) => r.organizationId === where.organizationId);
      return rows.slice(skip, skip + take);
    },
    count: async ({ where }: any) => {
      let rows = [...this.auditLogs.values()];
      if (where?.action)
        rows = rows.filter((r) => r.action === where.action.equals);
      if (where?.organizationId)
        rows = rows.filter((r) => r.organizationId === where.organizationId);
      return rows.length;
    },
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => [];
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

describe('Phase 8: platform admin / Super Admin (e2e)', () => {
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

  async function promoteSuperAdmin(userId: string) {
    await fakePrisma.user.update({
      where: { id: userId },
      data: { platformRole: 'SUPER_ADMIN' },
    });
  }

  describe('Authorization matrix', () => {
    let superAdminToken: string;
    let ownerToken: string;
    let managerId: string;
    let managerToken: string;
    let staffId: string;
    let staffToken: string;
    let orgId: string;

    beforeAll(async () => {
      const superAdmin = await registerAndLogin('sa-8@example.com');
      await promoteSuperAdmin(superAdmin.userId);
      // Re-login so the fresh JWT payload doesn't matter (platformRole is
      // re-read from the DB on every request by JwtStrategy, not baked
      // into the token) - the existing accessToken already works.
      superAdminToken = superAdmin.token;

      const owner = await registerAndLogin('owner-8@example.com');
      ownerToken = owner.token;
      orgId = await createOrg(ownerToken, 'Admin Test Org');

      const manager = await registerAndLogin('manager-8@example.com');
      managerId = manager.userId;
      managerToken = manager.token;
      await fakePrisma.organizationMembership.create({
        data: {
          userId: managerId,
          organizationId: orgId,
          role: 'MANAGER',
          status: 'ACTIVE',
        },
      });

      const staff = await registerAndLogin('staff-8@example.com');
      staffId = staff.userId;
      staffToken = staff.token;
      await fakePrisma.organizationMembership.create({
        data: {
          userId: staffId,
          organizationId: orgId,
          role: 'STAFF',
          status: 'ACTIVE',
        },
      });
    });

    it('SUPER_ADMIN can list organizations', async () => {
      const res = await request(server())
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it('OWNER is denied with 404 PLATFORM_ADMIN_ACCESS_DENIED', async () => {
      const res = await request(server())
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });

    it('MANAGER is denied', async () => {
      const res = await request(server())
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });

    it('STAFF is denied', async () => {
      const res = await request(server())
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });

    it('an unrelated outsider is denied', async () => {
      const outsider = await registerAndLogin('outsider-8@example.com');
      const res = await request(server())
        .get('/api/v1/admin/organizations')
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });

    it('SUPER_ADMIN is denied by every non-admin endpoint’s own guard is irrelevant here, but confirms admin write endpoints are equally protected', async () => {
      await request(server())
        .post(`/api/v1/admin/organizations/${orgId}/suspend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('Organization suspend/activate lifecycle + audit log', () => {
    let superAdminToken: string;
    let orgId: string;

    beforeAll(async () => {
      const superAdmin = await registerAndLogin('sa-suspend-8@example.com');
      await promoteSuperAdmin(superAdmin.userId);
      superAdminToken = superAdmin.token;

      const owner = await registerAndLogin('owner-suspend-8@example.com');
      orgId = await createOrg(owner.token, 'Suspend Test Org');
    });

    it('suspends an active organization', async () => {
      await request(server())
        .post(`/api/v1/admin/organizations/${orgId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const detail = await request(server())
        .get(`/api/v1/admin/organizations/${orgId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(detail.body.data.status).toBe('SUSPENDED');
    });

    it('rejects a duplicate suspend', async () => {
      const res = await request(server())
        .post(`/api/v1/admin/organizations/${orgId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('ORGANIZATION_ALREADY_SUSPENDED');
    });

    it('records an audit log entry for the suspension', async () => {
      const res = await request(server())
        .get('/api/v1/admin/audit-logs?action=ORGANIZATION_SUSPENDED')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(
        res.body.data.items.some((log: any) => log.entityId === orgId),
      ).toBe(true);
    });

    it('reactivates the organization', async () => {
      await request(server())
        .post(`/api/v1/admin/organizations/${orgId}/activate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const detail = await request(server())
        .get(`/api/v1/admin/organizations/${orgId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(detail.body.data.status).toBe('ACTIVE');
    });

    it('404s for an unknown organization', async () => {
      await request(server())
        .post(
          '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/suspend',
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
    });
  });

  describe('SaaS plan admin management', () => {
    let superAdminToken: string;

    beforeAll(async () => {
      const superAdmin = await registerAndLogin('sa-plans-8@example.com');
      await promoteSuperAdmin(superAdmin.userId);
      superAdminToken = superAdmin.token;
    });

    let newPlanId: string;

    it('creates a new plan', async () => {
      const res = await request(server())
        .post('/api/v1/admin/saas-plans')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: 'Pro', price: '999.00' })
        .expect(201);
      expect(res.body.data.price).toBe('999');
      newPlanId = res.body.data.id;
    });

    it('lists every plan, including inactive ones', async () => {
      const res = await request(server())
        .get('/api/v1/admin/saas-plans')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.some((p: any) => p.id === newPlanId)).toBe(true);
    });

    it('updates only cosmetic fields', async () => {
      const res = await request(server())
        .patch(`/api/v1/admin/saas-plans/${newPlanId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: 'Pro Plan' })
        .expect(200);
      expect(res.body.data.name).toBe('Pro Plan');
      expect(res.body.data.price).toBe('999'); // untouched
    });

    it('rejects a PATCH attempting to change price - price is not a whitelisted field', async () => {
      const res = await request(server())
        .patch(`/api/v1/admin/saas-plans/${newPlanId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ price: '1.00' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('deactivates the plan', async () => {
      const res = await request(server())
        .post(`/api/v1/admin/saas-plans/${newPlanId}/deactivate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('rejects deactivating an already-inactive plan', async () => {
      const res = await request(server())
        .post(`/api/v1/admin/saas-plans/${newPlanId}/deactivate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('SAAS_PLAN_ALREADY_INACTIVE');
    });
  });
});
