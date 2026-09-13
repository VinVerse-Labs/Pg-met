import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// An in-memory stand-in for PrismaService covering every table Phase 2
// touches (users, refresh_tokens, organizations, organization_memberships,
// properties). Lets the full HTTP stack - auth, guards, MembershipsService,
// OrganizationsService, PropertiesService, the response envelope - be
// exercised end to end without a real Postgres instance, following the
// same pattern as test/auth.e2e-spec.ts and test/health.e2e-spec.ts.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private properties = new Map<string, any>();

  // Real Prisma generates UUIDs (@default(uuid())) - DTOs like
  // CreatePropertyDto validate organizationId with @IsUUID(), so the fake
  // must produce ids in the same shape or every create call would fail
  // validation before ever reaching the service.
  private nextId(): string {
    return randomUUID();
  }

  user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) {
        return (
          [...this.users.values()].find((u) => u.email === where.email) ?? null
        );
      }
      if (where.phone) {
        return (
          [...this.users.values()].find((u) => u.phone === where.phone) ?? null
        );
      }
      return null;
    },
    create: async ({ data }: any) => {
      const emailTaken =
        data.email &&
        [...this.users.values()].some((u) => u.email === data.email);
      if (emailTaken) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['email'] },
          },
        );
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
        const matches = Object.entries(where).every(
          ([key, value]) => row[key] === value,
        );
        if (matches) {
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
      const membership = { id, createdAt: now, updatedAt: now, ...data };
      this.memberships.set(id, membership);
      return membership;
    },
    findFirst: async ({ where }: any) =>
      [...this.memberships.values()].find((m) =>
        Object.entries(where).every(([key, value]) => m[key] === value),
      ) ?? null,
    findMany: async ({ where, include }: any) => {
      const rows = [...this.memberships.values()].filter((m) =>
        Object.entries(where ?? {}).every(([key, value]) => m[key] === value),
      );
      if (include?.organization) {
        return rows.map((m) => ({
          ...m,
          organization: this.organizations.get(m.organizationId),
        }));
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
    findMany: async ({ where }: any) => {
      let rows = [...this.properties.values()];
      if (where?.organizationId) {
        const orgFilter = where.organizationId;
        rows = rows.filter((p) =>
          typeof orgFilter === 'string'
            ? p.organizationId === orgFilter
            : orgFilter.in.includes(p.organizationId),
        );
      }
      return rows;
    },
    update: async ({ where, data }: any) => {
      const property = this.properties.get(where.id);
      Object.assign(property, data);
      return property;
    },
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
  $queryRaw = jest.fn();
}

describe('Phase 2: organizations + properties (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  it('rejects unauthenticated organization creation', async () => {
    await request(server())
      .post('/api/v1/organizations')
      .send({ name: 'No Auth Org' })
      .expect(401);
  });

  it('creates an organization and makes the creator its OWNER', async () => {
    const owner = await registerAndLogin('owner1@example.com');

    const res = await request(server())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'ABC Living' })
      .expect(201);

    expect(res.body.data).toEqual(
      expect.objectContaining({ name: 'ABC Living', yourRole: 'OWNER' }),
    );
  });

  describe('Property creation, roles, and cross-tenant isolation', () => {
    let ownerA: { userId: string; accessToken: string };
    let outsider: { userId: string; accessToken: string };
    let orgAId: string;
    let propertyAId: string;

    beforeAll(async () => {
      ownerA = await registerAndLogin('ownerA@example.com');
      outsider = await registerAndLogin('outsider@example.com');

      const orgRes = await request(server())
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ name: 'Org A' })
        .expect(201);
      orgAId = orgRes.body.data.id;
    });

    it('lets the OWNER create a property', async () => {
      const res = await request(server())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          organizationId: orgAId,
          name: 'ABC Gachibowli',
          addressLine1: '123 Main St',
          city: 'Hyderabad',
          state: 'Telangana',
          postalCode: '500032',
        })
        .expect(201);
      propertyAId = res.body.data.id;
      expect(res.body.data.organizationId).toBe(orgAId);
    });

    it('rejects a non-member creating a property in organization A (organizationId spoofing)', async () => {
      const res = await request(server())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({
          organizationId: orgAId,
          name: 'Spoofed Property',
          addressLine1: '1 Fake St',
          city: 'Hyderabad',
          state: 'Telangana',
          postalCode: '500032',
        })
        .expect(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it("rejects reading organization A's detail as a non-member (BOLA on organizations)", async () => {
      const res = await request(server())
        .get(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it("rejects reading organization A's property as a non-member (BOLA/IDOR on properties)", async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
    });

    it("rejects modifying organization A's property as a non-member", async () => {
      await request(server())
        .patch(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ name: 'Hacked Name' })
        .expect(404);
    });

    it("rejects deleting/archiving organization A's property as a non-member", async () => {
      await request(server())
        .delete(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(404);
    });

    it('the OWNER can read the property it created', async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(propertyAId);
    });

    it("only shows the caller's accessible properties in the list endpoint", async () => {
      const res = await request(server())
        .get('/api/v1/properties')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);

      const ownerList = await request(server())
        .get('/api/v1/properties')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(200);
      expect(ownerList.body.data.some((p: any) => p.id === propertyAId)).toBe(
        true,
      );
    });

    it('a Manager or Owner is required to update - PATCH by the OWNER succeeds', async () => {
      const res = await request(server())
        .patch(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ name: 'ABC Gachibowli Updated' })
        .expect(200);
      expect(res.body.data.name).toBe('ABC Gachibowli Updated');
    });

    it('archiving is a soft delete: DELETE sets status to ARCHIVED, not a hard delete', async () => {
      const res = await request(server())
        .delete(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('ARCHIVED');

      // The record still exists and is still readable - archiving is not
      // deletion.
      const getRes = await request(server())
        .get(`/api/v1/properties/${propertyAId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .expect(200);
      expect(getRes.body.data.status).toBe('ARCHIVED');
    });
  });

  describe('A user belonging to multiple organizations with different roles', () => {
    it('sees both organizations, each with its own role', async () => {
      const user = await registerAndLogin('multiorg@example.com');

      await request(server())
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'First Org' })
        .expect(201);
      await request(server())
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Second Org' })
        .expect(201);

      const res = await request(server())
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const names = res.body.data.map((org: any) => org.name);
      expect(names).toEqual(
        expect.arrayContaining(['First Org', 'Second Org']),
      );
      expect(res.body.data.every((org: any) => org.yourRole === 'OWNER')).toBe(
        true,
      );
    });
  });
});
