import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// An in-memory stand-in for PrismaService covering every table exercised
// by the full chain: users, refresh_tokens, organizations,
// organization_memberships, properties, rooms, beds. Same pattern as
// test/auth.e2e-spec.ts and test/phase2-organizations-properties.e2e-spec.ts
// - proves the real HTTP stack (guards, RoomsService, BedsService, the
// ownership-chain scoping) end to end without a running Postgres instance.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private properties = new Map<string, any>();
  private rooms = new Map<string, any>();
  private beds = new Map<string, any>();

  private nextId(): string {
    return randomUUID();
  }

  private conflict(target: string): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: [target] },
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
    create: async ({ data }: any) => {
      const dup = [...this.rooms.values()].some(
        (r) =>
          r.propertyId === data.propertyId && r.roomNumber === data.roomNumber,
      );
      if (dup) this.conflict('propertyId_roomNumber');
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
    findMany: async ({ where }: any) =>
      [...this.rooms.values()].filter((r) => r.propertyId === where.propertyId),
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
    update: async ({ where, data }: any) => {
      const room = this.rooms.get(where.id);
      Object.assign(room, data);
      return room;
    },
  };

  bed = {
    create: async ({ data }: any) => {
      const dup = [...this.beds.values()].some(
        (b) => b.roomId === data.roomId && b.bedNumber === data.bedNumber,
      );
      if (dup) this.conflict('roomId_bedNumber');
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
    findMany: async ({ where }: any) =>
      [...this.beds.values()].filter((b) => b.roomId === where.roomId),
    findFirst: async ({ where }: any) =>
      [...this.beds.values()].find(
        (b) => b.id === where.id && b.roomId === where.roomId,
      ) ?? null,
    update: async ({ where, data }: any) => {
      const bed = this.beds.get(where.id);
      Object.assign(bed, data);
      return bed;
    },
  };

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => [];
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
}

describe('Phase 3: rooms + beds (e2e)', () => {
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

  describe('Room and bed creation, capacity, and duplicate constraints', () => {
    let ownerToken: string;
    let orgId: string;
    let propertyId: string;

    beforeAll(async () => {
      ownerToken = await registerAndLogin('roomsowner@example.com');
      orgId = await createOrg(ownerToken, 'Rooms Org');
      propertyId = await createProperty(ownerToken, orgId);
    });

    it('creates a room', async () => {
      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: '101', roomType: 'DOUBLE', capacity: 2 })
        .expect(201);

      expect(res.body.data.roomNumber).toBe('101');
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('rejects a duplicate room number in the same property', async () => {
      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: '101', roomType: 'SINGLE', capacity: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('allows the same room number in a DIFFERENT property', async () => {
      const otherPropertyId = await createProperty(ownerToken, orgId);
      const res = await request(server())
        .post(`/api/v1/properties/${otherPropertyId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: '101', roomType: 'SINGLE', capacity: 1 })
        .expect(201);
      expect(res.body.data.roomNumber).toBe('101');
    });

    it('rejects creating a room in a nonexistent property', async () => {
      await request(server())
        .post(`/api/v1/properties/${randomUUID()}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: '999', roomType: 'SINGLE', capacity: 1 })
        .expect(404);
    });

    describe('beds and capacity', () => {
      let roomId: string;

      beforeAll(async () => {
        const res = await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ roomNumber: 'CAP-ROOM', roomType: 'DOUBLE', capacity: 2 })
          .expect(201);
        roomId = res.body.data.id;
      });

      it('creates beds up to capacity', async () => {
        await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B1' })
          .expect(201);
        await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B2' })
          .expect(201);
      });

      it('rejects creating a bed beyond capacity', async () => {
        const res = await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B3' })
          .expect(409);
        expect(res.body.error.code).toBe('ROOM_CAPACITY_EXCEEDED');
      });

      it('rejects a duplicate bed number in the same room', async () => {
        // Archive one bed to free capacity, then try to reuse an existing
        // bed number rather than an all-new one.
        const listRes = await request(server())
          .get(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        const firstBedId = listRes.body.data[0].id;
        await request(server())
          .delete(
            `/api/v1/properties/${propertyId}/rooms/${roomId}/beds/${firstBedId}`,
          )
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        const res = await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B2' })
          .expect(409);
        expect(res.body.error.code).toBe('CONFLICT');
      });

      it('allows the same bed number in a DIFFERENT room', async () => {
        const otherRoomRes = await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ roomNumber: 'OTHER-ROOM', roomType: 'SINGLE', capacity: 2 })
          .expect(201);
        const otherRoomId = otherRoomRes.body.data.id;

        await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${otherRoomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B2' })
          .expect(201);
      });

      it('does not count an archived bed toward capacity (freed a slot above)', async () => {
        // After archiving one bed in "creates beds up to capacity"'s room,
        // exactly one more bed can be created (proven by the successful
        // reuse-a-different-number case below, since B2 slot was freed).
        const res = await request(server())
          .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ bedNumber: 'B4' })
          .expect(201);
        expect(res.body.data.bedNumber).toBe('B4');
      });
    });

    it('rejects capacity below the current active bed count', async () => {
      const roomRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: 'SHRINK-ROOM', roomType: 'DOUBLE', capacity: 2 })
        .expect(201);
      const shrinkRoomId = roomRes.body.data.id;
      await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms/${shrinkRoomId}/beds`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedNumber: 'B1' })
        .expect(201);
      await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms/${shrinkRoomId}/beds`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedNumber: 'B2' })
        .expect(201);

      const res = await request(server())
        .patch(`/api/v1/properties/${propertyId}/rooms/${shrinkRoomId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ capacity: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('ROOM_CAPACITY_BELOW_BED_COUNT');
    });

    it('rejects creating a room in an archived property', async () => {
      const archivableProperty = await createProperty(ownerToken, orgId);
      await request(server())
        .delete(`/api/v1/properties/${archivableProperty}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(server())
        .post(`/api/v1/properties/${archivableProperty}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: '1', roomType: 'SINGLE', capacity: 1 })
        .expect(409);
      expect(res.body.error.code).toBe('PROPERTY_NOT_ACTIVE');
    });

    it('rejects creating a bed in an archived room', async () => {
      const roomRes = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ roomNumber: 'ARCHIVE-ME', roomType: 'SINGLE', capacity: 2 })
        .expect(201);
      const archivedRoomId = roomRes.body.data.id;
      await request(server())
        .delete(`/api/v1/properties/${propertyId}/rooms/${archivedRoomId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(server())
        .post(`/api/v1/properties/${propertyId}/rooms/${archivedRoomId}/beds`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ bedNumber: 'B1' })
        .expect(409);
      expect(res.body.error.code).toBe('ROOM_NOT_ACTIVE');
    });
  });

  describe('Cross-organization security: Organization A vs Organization B', () => {
    let ownerAToken: string;
    let ownerBToken: string;
    let orgAId: string;
    let propertyAId: string;
    let roomAId: string;
    let bedAId: string;
    let propertyBId: string;
    let roomBId: string;

    beforeAll(async () => {
      ownerAToken = await registerAndLogin('secOwnerA@example.com');
      ownerBToken = await registerAndLogin('secOwnerB@example.com');

      orgAId = await createOrg(ownerAToken, 'Org A');
      const orgBId = await createOrg(ownerBToken, 'Org B');

      propertyAId = await createProperty(ownerAToken, orgAId);
      propertyBId = await createProperty(ownerBToken, orgBId);

      const roomARes = await request(server())
        .post(`/api/v1/properties/${propertyAId}/rooms`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ roomNumber: '101', roomType: 'SINGLE', capacity: 1 })
        .expect(201);
      roomAId = roomARes.body.data.id;

      const roomBRes = await request(server())
        .post(`/api/v1/properties/${propertyBId}/rooms`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ roomNumber: '201', roomType: 'SINGLE', capacity: 1 })
        .expect(201);
      roomBId = roomBRes.body.data.id;

      const bedARes = await request(server())
        .post(`/api/v1/properties/${propertyAId}/rooms/${roomAId}/beds`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ bedNumber: 'B1' })
        .expect(201);
      bedAId = bedARes.body.data.id;
    });

    it('User B cannot GET Room A', async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyAId}/rooms/${roomAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('User B cannot GET Bed A', async () => {
      const res = await request(server())
        .get(
          `/api/v1/properties/${propertyAId}/rooms/${roomAId}/beds/${bedAId}`,
        )
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('User B cannot PATCH Room A', async () => {
      await request(server())
        .patch(`/api/v1/properties/${propertyAId}/rooms/${roomAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ roomNumber: 'Hacked' })
        .expect(404);
    });

    it('User B cannot PATCH Bed A', async () => {
      await request(server())
        .patch(
          `/api/v1/properties/${propertyAId}/rooms/${roomAId}/beds/${bedAId}`,
        )
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ bedNumber: 'Hacked' })
        .expect(404);
    });

    it('User B cannot DELETE (archive) Room A', async () => {
      await request(server())
        .delete(`/api/v1/properties/${propertyAId}/rooms/${roomAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
    });

    it('User B cannot DELETE (archive) Bed A', async () => {
      await request(server())
        .delete(
          `/api/v1/properties/${propertyAId}/rooms/${roomAId}/beds/${bedAId}`,
        )
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
    });

    it('User B cannot create a room using Property A (organizationId/propertyId spoofing)', async () => {
      const res = await request(server())
        .post(`/api/v1/properties/${propertyAId}/rooms`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ roomNumber: 'Spoofed', roomType: 'SINGLE', capacity: 1 })
        .expect(404);
      expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
    });

    it('User B cannot create a bed using Room A', async () => {
      // BedsService.create verifies the property first - propertyAId
      // belongs to Org A, which ownerB has no membership in, so this is
      // rejected before the room is even considered.
      const res = await request(server())
        .post(`/api/v1/properties/${propertyAId}/rooms/${roomAId}/beds`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ bedNumber: 'Spoofed' })
        .expect(404);
      expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
    });

    it("User B cannot create a bed by combining Room A's id with Property B in the URL (mismatched chain)", async () => {
      // Room A does not belong to Property B - the scoped query requires
      // both roomId AND propertyId to agree, so this is rejected exactly
      // like a nonexistent room would be, not treated as "found via a
      // different path".
      const res = await request(server())
        .post(`/api/v1/properties/${propertyBId}/rooms/${roomAId}/beds`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ bedNumber: 'Mismatched' })
        .expect(404);
      expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it("User A's own room/bed in Org A still works normally", async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${propertyAId}/rooms/${roomAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(roomAId);
    });

    it('confirms Room B is unaffected and independently accessible only to User B', async () => {
      await request(server())
        .get(`/api/v1/properties/${propertyBId}/rooms/${roomBId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(404);
      await request(server())
        .get(`/api/v1/properties/${propertyBId}/rooms/${roomBId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(200);
    });
  });
});
