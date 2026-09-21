import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PushDevicesService } from './push-devices.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Tenant',
    email: 'tenant@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildDevice(overrides: Partial<any> = {}) {
  return {
    id: 'device-1',
    userId: 'user-1',
    platform: 'ANDROID',
    provider: 'EXPO',
    token: 'ExponentPushToken[abc]',
    deviceId: null,
    appVersion: null,
    isActive: true,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PushDevicesService', () => {
  let service: PushDevicesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      pushDevice: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    service = new PushDevicesService(prisma);
  });

  describe('register', () => {
    it('creates a new device when the (provider, token) pair is unseen', async () => {
      prisma.pushDevice.findUnique.mockResolvedValue(null);
      prisma.pushDevice.create.mockResolvedValue(buildDevice());

      await service.register(buildUser(), {
        platform: 'ANDROID' as any,
        token: 'ExponentPushToken[abc]',
      });

      expect(prisma.pushDevice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          provider: 'EXPO',
          token: 'ExponentPushToken[abc]',
        }),
      });
      expect(prisma.pushDevice.update).not.toHaveBeenCalled();
    });

    it('re-registering the same (provider, token) updates the existing row in place, not a duplicate', async () => {
      prisma.pushDevice.findUnique.mockResolvedValue(
        buildDevice({ id: 'device-1' }),
      );
      prisma.pushDevice.update.mockResolvedValue(
        buildDevice({ id: 'device-1' }),
      );

      await service.register(buildUser(), {
        platform: 'IOS' as any,
        token: 'ExponentPushToken[abc]',
      });

      expect(prisma.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: expect.objectContaining({
          userId: 'user-1',
          platform: 'IOS',
          isActive: true,
        }),
      });
      expect(prisma.pushDevice.create).not.toHaveBeenCalled();
    });

    it('reassigns the token to a new user when the same physical token is presented by someone else', async () => {
      prisma.pushDevice.findUnique.mockResolvedValue(
        buildDevice({ id: 'device-1', userId: 'previous-user' }),
      );
      prisma.pushDevice.update.mockResolvedValue(
        buildDevice({ id: 'device-1', userId: 'new-user' }),
      );

      await service.register(buildUser({ id: 'new-user' }), {
        platform: 'ANDROID' as any,
        token: 'ExponentPushToken[abc]',
      });

      expect(prisma.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: expect.objectContaining({ userId: 'new-user' }),
      });
    });

    it('defaults provider to EXPO when not supplied', async () => {
      prisma.pushDevice.findUnique.mockResolvedValue(null);
      prisma.pushDevice.create.mockResolvedValue(buildDevice());

      await service.register(buildUser(), {
        platform: 'ANDROID' as any,
        token: 'tok',
      });

      expect(prisma.pushDevice.findUnique).toHaveBeenCalledWith({
        where: {
          push_devices_provider_token_unique: {
            provider: 'EXPO',
            token: 'tok',
          },
        },
      });
    });
  });

  describe('findForUser', () => {
    it('scopes to the caller’s own devices only', async () => {
      prisma.pushDevice.findMany.mockResolvedValue([buildDevice()]);
      await service.findForUser(buildUser());
      expect(prisma.pushDevice.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { lastSeenAt: 'desc' },
      });
    });
  });

  describe('remove (BOLA safety)', () => {
    it('removes only when id + userId both match', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 1 });
      await service.remove(buildUser(), 'device-1');
      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { id: 'device-1', userId: 'user-1' },
      });
    });

    it('throws PUSH_DEVICE_NOT_FOUND when the device belongs to another user (never a silent no-op leak)', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.remove(buildUser({ id: 'attacker' }), 'device-1'),
      ).rejects.toMatchObject({ code: ErrorCode.PUSH_DEVICE_NOT_FOUND });
    });
  });
});
