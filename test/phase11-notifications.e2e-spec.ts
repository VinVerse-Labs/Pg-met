import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite
// (see test/phase9-complaints.e2e-spec.ts). Scoped to what Phase 11's own
// HTTP surface needs: auth (user/refreshToken, unchanged from every prior
// suite) plus Notification/NotificationPreference/PushDevice/
// NotificationDelivery. Notifications are seeded directly via
// `fakePrisma.seedNotification(...)` rather than by driving a full
// business flow end-to-end - the business-event -> notification wiring
// itself is already covered by each business module's own unit tests and
// by NotificationEventService's unit tests; this suite's job is the
// notification HTTP surface itself: list/read/mark-read, preferences,
// push devices, the admin aggregate endpoint, and cross-user/
// cross-organization isolation (BOLA).
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private notifications = new Map<string, any>();
  private notificationPreferences = new Map<string, any>();
  private pushDevices = new Map<string, any>();
  private notificationDeliveries = new Map<string, any>();

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

  notification = {
    findMany: async ({ where, orderBy, skip = 0, take = 20 }: any) => {
      let rows = [...this.notifications.values()].filter((n) =>
        this.matchesWhere(n, where),
      );
      const [field, dir] = Object.entries(
        orderBy ?? { createdAt: 'desc' },
      )[0] as [string, 'asc' | 'desc'];
      rows = rows.sort((a, b) => {
        const cmp = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
        return dir === 'asc' ? cmp : -cmp;
      });
      return rows.slice(skip, skip + take);
    },
    count: async (args: any = {}) =>
      [...this.notifications.values()].filter((n) =>
        this.matchesWhere(n, args?.where),
      ).length,
    findFirst: async ({ where }: any) =>
      [...this.notifications.values()].find((n) =>
        this.matchesWhere(n, where),
      ) ?? null,
    updateMany: async ({ where, data }: any) => {
      const rows = [...this.notifications.values()].filter((n) =>
        this.matchesWhere(n, where),
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  };

  private matchesWhere(n: any, where: any): boolean {
    if (!where) return true;
    if (where.id && n.id !== where.id) return false;
    if (where.userId && n.userId !== where.userId) return false;
    if (where.status && n.status !== where.status) return false;
    return true;
  }

  notificationPreference = {
    findMany: async ({ where }: any) =>
      [...this.notificationPreferences.values()].filter(
        (p) => p.userId === where.userId,
      ),
    findUnique: async ({ where }: any) => {
      const key = where.notification_preferences_user_type_channel_unique;
      return (
        [...this.notificationPreferences.values()].find(
          (p) =>
            p.userId === key.userId &&
            p.notificationType === key.notificationType &&
            p.channel === key.channel,
        ) ?? null
      );
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.notification_preferences_user_type_channel_unique;
      const existing = [...this.notificationPreferences.values()].find(
        (p) =>
          p.userId === key.userId &&
          p.notificationType === key.notificationType &&
          p.channel === key.channel,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const id = this.nextId();
      const now = new Date();
      const row = { id, createdAt: now, updatedAt: now, ...create };
      this.notificationPreferences.set(id, row);
      return row;
    },
  };

  pushDevice = {
    findUnique: async ({ where }: any) => {
      const key = where.push_devices_provider_token_unique;
      return (
        [...this.pushDevices.values()].find(
          (d) => d.provider === key.provider && d.token === key.token,
        ) ?? null
      );
    },
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const device = {
        id,
        isActive: true,
        deviceId: null,
        appVersion: null,
        lastSeenAt: now,
        createdAt: now,
        ...data,
      };
      this.pushDevices.set(id, device);
      return device;
    },
    update: async ({ where, data }: any) => {
      const device = this.pushDevices.get(where.id);
      Object.assign(device, data);
      return device;
    },
    findMany: async ({ where }: any) =>
      [...this.pushDevices.values()].filter((d) => d.userId === where.userId),
    findFirst: async ({ where }: any) =>
      [...this.pushDevices.values()].find(
        (d) => d.userId === where.userId && d.isActive === where.isActive,
      ) ?? null,
    deleteMany: async ({ where }: any) => {
      const rows = [...this.pushDevices.values()].filter(
        (d) => d.id === where.id && d.userId === where.userId,
      );
      for (const row of rows) this.pushDevices.delete(row.id);
      return { count: rows.length };
    },
  };

  notificationDelivery = {
    findUnique: async ({ where }: any) => {
      const key = where.notification_deliveries_notification_channel_unique;
      return (
        [...this.notificationDeliveries.values()].find(
          (d) =>
            d.notificationId === key.notificationId &&
            d.channel === key.channel,
        ) ?? null
      );
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.notification_deliveries_notification_channel_unique;
      const existing = [...this.notificationDeliveries.values()].find(
        (d) =>
          d.notificationId === key.notificationId && d.channel === key.channel,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const id = this.nextId();
      this.notificationDeliveries.set(id, { id, ...create });
      return { id, ...create };
    },
    groupBy: async ({ by, where }: any) => {
      const rows = [...this.notificationDeliveries.values()].filter((d) =>
        where ? this.matchesWhere(d, where) : true,
      );
      const field = by[0];
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({
        [field]: value,
        _count: { _all: count },
      }));
    },
  };

  $transaction = async (arg: any) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  };
  $queryRaw = async () => [];
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();

  // Test-only helper: seed a notification row directly for a user,
  // bypassing NotificationsService.publish (whose idempotency/delivery
  // behavior is already covered by its own unit tests) so this suite can
  // exercise the read/mark-read/list HTTP surface directly.
  seedNotification(userId: string, overrides: Partial<any> = {}) {
    const id = this.nextId();
    const now = new Date();
    const notification = {
      id,
      userId,
      organizationId: null,
      propertyId: null,
      type: 'SYSTEM_ANNOUNCEMENT',
      title: 'Test notification',
      body: 'Test body',
      data: null,
      priority: 'NORMAL',
      status: 'UNREAD',
      idempotencyKey: `seed:${id}`,
      readAt: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.notifications.set(id, notification);
    return notification;
  }

  seedDelivery(notificationId: string, channel: string, status: string) {
    const id = this.nextId();
    this.notificationDeliveries.set(id, {
      id,
      notificationId,
      channel,
      status,
      provider: channel,
      providerMessageId: null,
      failureReason: null,
      attemptCount: 1,
      lastAttemptAt: new Date(),
      deliveredAt: status === 'SENT' ? new Date() : null,
      failedAt: status === 'FAILED' ? new Date() : null,
    });
  }
}

describe('Phase 11: notifications & communication infrastructure (e2e)', () => {
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

  describe('GET /me/notifications, unread-count, get-one', () => {
    let user: { token: string; userId: string };
    let notifA: any;
    let notifB: any;

    beforeAll(async () => {
      user = await registerAndLogin('list11@example.com');
      notifA = fakePrisma.seedNotification(user.userId, {
        title: 'First',
        createdAt: new Date('2026-01-01'),
      });
      notifB = fakePrisma.seedNotification(user.userId, {
        title: 'Second',
        createdAt: new Date('2026-01-02'),
      });
    });

    it('lists the caller’s own notifications, newest first', async () => {
      const res = await request(server())
        .get('/api/v1/me/notifications')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.items[0].id).toBe(notifB.id);
      expect(res.body.data.items[0].isRead).toBe(false);
    });

    it('filters to unreadOnly=true', async () => {
      fakePrisma.seedNotification(user.userId, {
        title: 'Already read',
        status: 'READ',
        readAt: new Date(),
      });
      const res = await request(server())
        .get('/api/v1/me/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.items.every((n: any) => n.isRead === false)).toBe(
        true,
      );
    });

    it('unread-count is database-aggregated', async () => {
      const res = await request(server())
        .get('/api/v1/me/notifications/unread-count')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.count).toBeGreaterThanOrEqual(2);
    });

    it('gets a single notification by id', async () => {
      const res = await request(server())
        .get(`/api/v1/me/notifications/${notifA.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.id).toBe(notifA.id);
      expect(res.body.data.title).toBe('First');
    });

    it('never exposes delivery internals on the notification response (no providerMessageId/attemptCount fields)', async () => {
      const res = await request(server())
        .get(`/api/v1/me/notifications/${notifA.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.providerMessageId).toBeUndefined();
      expect(res.body.data.attemptCount).toBeUndefined();
    });
  });

  describe('POST /me/notifications/:id/read and /read-all', () => {
    let user: { token: string; userId: string };
    let notif: any;

    beforeAll(async () => {
      user = await registerAndLogin('read11@example.com');
      notif = fakePrisma.seedNotification(user.userId);
    });

    it('marks one notification READ', async () => {
      const res = await request(server())
        .post(`/api/v1/me/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.isRead).toBe(true);
    });

    it('is idempotent: marking an already-READ notification again still succeeds', async () => {
      const res = await request(server())
        .post(`/api/v1/me/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.isRead).toBe(true);
    });

    it('mark-all-read flips every remaining UNREAD row for the caller', async () => {
      fakePrisma.seedNotification(user.userId);
      fakePrisma.seedNotification(user.userId);
      const res = await request(server())
        .post('/api/v1/me/notifications/read-all')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.updated).toBe(2);

      const list = await request(server())
        .get('/api/v1/me/notifications/unread-count')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(list.body.data.count).toBe(0);
    });

    it('404s for a nonexistent notification id', async () => {
      const res = await request(server())
        .post('/api/v1/me/notifications/does-not-exist/read')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });
  });

  describe('Cross-user isolation (BOLA)', () => {
    let userA: { token: string; userId: string };
    let userB: { token: string; userId: string };
    let notifA: any;

    beforeAll(async () => {
      userA = await registerAndLogin('bolaA-notif11@example.com');
      userB = await registerAndLogin('bolaB-notif11@example.com');
      notifA = fakePrisma.seedNotification(userA.userId, { title: 'A only' });
    });

    it('User B cannot read User A’s notification (404, not 403 — existence hidden)', async () => {
      const res = await request(server())
        .get(`/api/v1/me/notifications/${notifA.id}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('User B cannot mark User A’s notification read, and it remains UNREAD', async () => {
      await request(server())
        .post(`/api/v1/me/notifications/${notifA.id}/read`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);

      const stillUnread = await request(server())
        .get(`/api/v1/me/notifications/${notifA.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      expect(stillUnread.body.data.isRead).toBe(false);
    });

    it('User B’s notification list never includes User A’s notifications', async () => {
      fakePrisma.seedNotification(userB.userId, { title: 'B only' });
      const res = await request(server())
        .get('/api/v1/me/notifications')
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(200);
      expect(res.body.data.items.every((n: any) => n.title !== 'A only')).toBe(
        true,
      );
    });

    it('User B’s mark-all-read never touches User A’s notifications', async () => {
      await request(server())
        .post('/api/v1/me/notifications/read-all')
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(200);

      const aStillUnread = await request(server())
        .get(`/api/v1/me/notifications/${notifA.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      expect(aStillUnread.body.data.isRead).toBe(false);
    });
  });

  describe('GET/PUT /me/notifications/preferences', () => {
    let user: { token: string; userId: string };

    beforeAll(async () => {
      user = await registerAndLogin('prefs11@example.com');
    });

    it('starts with no explicit preferences set', async () => {
      const res = await request(server())
        .get('/api/v1/me/notifications/preferences')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('upserts preferences in a batch', async () => {
      const res = await request(server())
        .put('/api/v1/me/notifications/preferences')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          preferences: [
            {
              notificationType: 'FOOD_MENU_UPDATED',
              channel: 'EMAIL',
              enabled: true,
            },
            {
              notificationType: 'RENT_INVOICE_ISSUED',
              channel: 'PUSH',
              enabled: false,
            },
          ],
        })
        .expect(200);
      expect(res.body.data.length).toBe(2);
    });

    it('rejects disabling the mandatory IN_APP channel', async () => {
      const res = await request(server())
        .put('/api/v1/me/notifications/preferences')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          preferences: [
            {
              notificationType: 'FOOD_MENU_UPDATED',
              channel: 'IN_APP',
              enabled: false,
            },
          ],
        })
        .expect(409);
      expect(res.body.error.code).toBe('NOTIFICATION_MANDATORY_TYPE');
    });

    it('a rejected batch never partially applies (IN_APP rejection alongside a valid entry writes nothing)', async () => {
      await request(server())
        .put('/api/v1/me/notifications/preferences')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          preferences: [
            {
              notificationType: 'COMPLAINT_CREATED',
              channel: 'SMS',
              enabled: true,
            },
            {
              notificationType: 'FOOD_MENU_UPDATED',
              channel: 'IN_APP',
              enabled: false,
            },
          ],
        })
        .expect(409);

      const res = await request(server())
        .get('/api/v1/me/notifications/preferences')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(
        res.body.data.some(
          (p: any) => p.notificationType === 'COMPLAINT_CREATED',
        ),
      ).toBe(false);
    });
  });

  describe('GET/POST/DELETE /me/notifications/devices', () => {
    let user: { token: string; userId: string };
    let otherUser: { token: string; userId: string };
    let deviceId: string;

    beforeAll(async () => {
      user = await registerAndLogin('devices11@example.com');
      otherUser = await registerAndLogin('devices11b@example.com');
    });

    it('registers a new push device', async () => {
      const res = await request(server())
        .post('/api/v1/me/notifications/devices')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          platform: 'ANDROID',
          token: 'ExponentPushToken[test-device-11]',
        })
        .expect(201);
      expect(res.body.data.platform).toBe('ANDROID');
      expect(res.body.data.token).toBeUndefined();
      deviceId = res.body.data.id;
    });

    it('lists only the caller’s own devices', async () => {
      const res = await request(server())
        .get('/api/v1/me/notifications/devices')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.some((d: any) => d.id === deviceId)).toBe(true);
    });

    it('re-registering the same token updates it in place, never a duplicate', async () => {
      await request(server())
        .post('/api/v1/me/notifications/devices')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ platform: 'IOS', token: 'ExponentPushToken[test-device-11]' })
        .expect(201);

      const res = await request(server())
        .get('/api/v1/me/notifications/devices')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].platform).toBe('IOS');
    });

    it('another user cannot delete this user’s device (BOLA-safe 404)', async () => {
      const res = await request(server())
        .delete(`/api/v1/me/notifications/devices/${deviceId}`)
        .set('Authorization', `Bearer ${otherUser.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('PUSH_DEVICE_NOT_FOUND');
    });

    it('the owning user can remove their own device', async () => {
      await request(server())
        .delete(`/api/v1/me/notifications/devices/${deviceId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(204);

      const res = await request(server())
        .get('/api/v1/me/notifications/devices')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('GET /admin/notifications/overview (platform-admin only, aggregate-only)', () => {
    let owner: { token: string; userId: string };
    let superAdmin: { token: string; userId: string };

    beforeAll(async () => {
      owner = await registerAndLogin('admin11-owner@example.com');
      const notif = fakePrisma.seedNotification(owner.userId);
      fakePrisma.seedDelivery(notif.id, 'IN_APP', 'SENT');
      fakePrisma.seedDelivery(notif.id, 'EMAIL', 'SKIPPED');

      const sa = await registerAndLogin('admin11-sa@example.com');
      await fakePrisma.user.update({
        where: { id: sa.userId },
        data: { platformRole: 'SUPER_ADMIN' },
      });
      superAdmin = sa;
    });

    it('a non-admin gets 404 (existence hidden), never sees notification data', async () => {
      const res = await request(server())
        .get('/api/v1/admin/notifications/overview')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });

    it('SUPER_ADMIN sees aggregate counts only - never individual notification content', async () => {
      const res = await request(server())
        .get('/api/v1/admin/notifications/overview')
        .set('Authorization', `Bearer ${superAdmin.token}`)
        .expect(200);
      expect(typeof res.body.data.totalNotifications).toBe('number');
      expect(typeof res.body.data.unreadNotifications).toBe('number');
      expect(res.body.data.deliveriesByStatus).toBeDefined();
      expect(res.body.data.deliveriesByChannel).toBeDefined();
      // No per-notification listing endpoint exists at all; the overview
      // payload itself carries no titles/bodies/userIds.
      expect(JSON.stringify(res.body.data)).not.toMatch(/Test notification/);
    });

    it('there is no admin endpoint that lists individual notifications', async () => {
      await request(server())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${superAdmin.token}`)
        .expect(404);
    });
  });
});
