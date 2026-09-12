import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// A minimal in-memory stand-in for PrismaService, scoped to exactly the
// two tables the auth flow touches (users, refresh_tokens). This proves
// the full HTTP stack - controllers, guards, DT33 validation, AuthService,
// TokenService, the global response envelope - end to end, without needing
// a real Postgres instance for CI.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private nextUserId = 1;
  private nextTokenId = 1;

  user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) {
        return (
          [...this.users.values()].find((u) => u.email === where.email) ??
          null
        );
      }
      if (where.phone) {
        return (
          [...this.users.values()].find((u) => u.phone === where.phone) ??
          null
        );
      }
      return null;
    },
    create: async ({ data }: any) => {
      const emailTaken =
        data.email &&
        [...this.users.values()].some((u) => u.email === data.email);
      const phoneTaken =
        data.phone &&
        [...this.users.values()].some((u) => u.phone === data.phone);
      if (emailTaken || phoneTaken) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: [emailTaken ? 'email' : 'phone'] },
          },
        );
      }
      const id = `user-${this.nextUserId++}`;
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
      const id = `rt-${this.nextTokenId++}`;
      const row = {
        id,
        revokedAt: null,
        lastUsedAt: null,
        userAgent: null,
        ipAddress: null,
        createdAt: new Date(),
        ...data,
      };
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

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();
  $queryRaw = jest.fn();
}

describe('Auth (e2e)', () => {
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

  it('registers a new user and returns tokens + a safe user profile', async () => {
    const response = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Rahul', email: 'rahul@example.com', password: 'password123' })
      .expect(201);

    expect(response.body.data.user).toEqual(
      expect.objectContaining({ name: 'Rahul', email: 'rahul@example.com' }),
    );
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(response.body.data.tokens.refreshToken).toEqual(expect.any(String));
  });

  it('rejects registering the same email twice with 409 CONFLICT', async () => {
    await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Dup', email: 'dup@example.com', password: 'password123' })
      .expect(201);

    const response = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Dup Again', email: 'dup@example.com', password: 'password123' })
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects registering with neither email nor phone', async () => {
    const response = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'No Contact', password: 'password123' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  describe('login -> me -> refresh -> logout', () => {
    const credentials = {
      name: 'Asha',
      email: 'asha@example.com',
      password: 'password123',
    };

    beforeAll(async () => {
      await request(server())
        .post('/api/v1/auth/register')
        .send(credentials)
        .expect(201);
    });

    it('rejects login with a wrong password using a generic error', async () => {
      const response = await request(server())
        .post('/api/v1/auth/login')
        .send({ identifier: credentials.email, password: 'wrong-password' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login for a nonexistent account with the SAME generic error', async () => {
      const response = await request(server())
        .post('/api/v1/auth/login')
        .send({ identifier: 'nobody@example.com', password: 'whatever123' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects GET /auth/me with no token', async () => {
      await request(server()).get('/api/v1/auth/me').expect(401);
    });

    it('rejects GET /auth/me with a garbage token', async () => {
      const response = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      expect(response.body.error.code).toBe('TOKEN_INVALID');
    });

    it('logs in, fetches /me, rotates the refresh token, then logs out', async () => {
      const loginResponse = await request(server())
        .post('/api/v1/auth/login')
        .send({ identifier: credentials.email, password: credentials.password })
        .expect(200);

      const { accessToken, refreshToken } = loginResponse.body.data.tokens;

      const meResponse = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(meResponse.body.data.email).toBe(credentials.email);
      expect(meResponse.body.data.passwordHash).toBeUndefined();

      const refreshResponse = await request(server())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      const rotated = refreshResponse.body.data;
      expect(rotated.refreshToken).not.toBe(refreshToken);

      // The old refresh token was rotated away - reusing it is now reuse
      // detection, not a normal expired/invalid error.
      const reuseResponse = await request(server())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      expect(reuseResponse.body.error.code).toBe('TOKEN_REVOKED');

      // Reuse detection revokes every session for the user, so even the
      // freshly-rotated token from this same flow is now dead too.
      const rotatedRefreshAfterReuse = await request(server())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.refreshToken })
        .expect(401);
      expect(rotatedRefreshAfterReuse.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('logout is idempotent for an already-revoked/unknown refresh token', async () => {
      const loginResponse = await request(server())
        .post('/api/v1/auth/login')
        .send({ identifier: credentials.email, password: credentials.password })
        .expect(200);
      const { refreshToken } = loginResponse.body.data.tokens;

      await request(server())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(200);

      await request(server())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(200);
    });
  });
});
