import { NotificationDeliveryService } from './notification-delivery.service';

function buildNotification(overrides: Partial<any> = {}): any {
  return {
    id: 'notif-1',
    userId: 'user-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    type: 'RENT_INVOICE_ISSUED',
    title: 'Rent invoice issued',
    body: 'Invoice INV-1 for 5000 is due.',
    data: null,
    priority: 'NORMAL',
    status: 'UNREAD',
    idempotencyKey: 'RENT_INVOICE_ISSUED:inv-1',
    readAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;
  let prisma: any;
  let preferences: { isChannelEnabled: jest.Mock };
  let inAppProvider: { providerName: string; send: jest.Mock };
  let pushProvider: { providerName: string; send: jest.Mock };
  let emailProvider: { providerName: string; send: jest.Mock };
  let whatsappProvider: { providerName: string; send: jest.Mock };
  let smsProvider: { providerName: string; send: jest.Mock };

  beforeEach(() => {
    prisma = {
      pushDevice: { findFirst: jest.fn() },
      notificationDelivery: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    preferences = { isChannelEnabled: jest.fn().mockResolvedValue(true) };
    inAppProvider = {
      providerName: 'IN_APP',
      send: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    pushProvider = {
      providerName: 'PUSH',
      send: jest
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', failureReason: 'no provider' }),
    };
    emailProvider = {
      providerName: 'EMAIL',
      send: jest
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', failureReason: 'no provider' }),
    };
    whatsappProvider = {
      providerName: 'WHATSAPP',
      send: jest
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', failureReason: 'no provider' }),
    };
    smsProvider = {
      providerName: 'SMS',
      send: jest
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', failureReason: 'no provider' }),
    };

    prisma.notificationDelivery.findUnique.mockResolvedValue(null);
    prisma.notificationDelivery.upsert.mockResolvedValue({});

    service = new NotificationDeliveryService(
      prisma,
      preferences as any,
      inAppProvider as any,
      pushProvider as any,
      emailProvider as any,
      whatsappProvider as any,
      smsProvider as any,
    );
  });

  it('attempts delivery on all 5 channels for a fully-enabled notification', async () => {
    prisma.pushDevice.findFirst.mockResolvedValue({ id: 'device-1' });
    await service.deliverAll(buildNotification());

    expect(inAppProvider.send).toHaveBeenCalledTimes(1);
    expect(pushProvider.send).toHaveBeenCalledTimes(1);
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
    expect(whatsappProvider.send).toHaveBeenCalledTimes(1);
    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationDelivery.upsert).toHaveBeenCalledTimes(5);
  });

  it('a disabled channel is recorded SKIPPED and the provider is never invoked', async () => {
    preferences.isChannelEnabled.mockImplementation(
      async (_userId: string, _type: string, channel: string) =>
        channel !== 'EMAIL',
    );
    prisma.pushDevice.findFirst.mockResolvedValue({ id: 'device-1' });

    await service.deliverAll(buildNotification());

    expect(emailProvider.send).not.toHaveBeenCalled();
    const emailUpsertCall = prisma.notificationDelivery.upsert.mock.calls.find(
      (c: any) => c[0].create.channel === 'EMAIL',
    );
    expect(emailUpsertCall[0].create.status).toBe('SKIPPED');
    expect(emailUpsertCall[0].create.provider).toBe('NONE');
  });

  it('PUSH with no active device is SKIPPED even when the channel preference is enabled', async () => {
    prisma.pushDevice.findFirst.mockResolvedValue(null);

    await service.deliverAll(buildNotification());

    expect(pushProvider.send).not.toHaveBeenCalled();
    const pushUpsertCall = prisma.notificationDelivery.upsert.mock.calls.find(
      (c: any) => c[0].create.channel === 'PUSH',
    );
    expect(pushUpsertCall[0].create.status).toBe('SKIPPED');
    expect(pushUpsertCall[0].create.failureReason).toMatch(
      /no active push device/i,
    );
  });

  it('a provider throwing outright never escapes deliverAll (caught and logged, other channels still processed)', async () => {
    prisma.pushDevice.findFirst.mockResolvedValue({ id: 'device-1' });
    inAppProvider.send.mockRejectedValue(new Error('provider exploded'));

    await expect(
      service.deliverAll(buildNotification()),
    ).resolves.toBeUndefined();
    // Other channels still get a chance to run.
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
  });

  it('recordDelivery upserts on (notificationId, channel) — never a plain create — so repeated attempts never duplicate rows', async () => {
    prisma.pushDevice.findFirst.mockResolvedValue({ id: 'device-1' });
    prisma.notificationDelivery.findUnique.mockResolvedValue({
      attemptCount: 2,
      deliveredAt: null,
    });

    await service.deliverAll(buildNotification());

    const inAppCall = prisma.notificationDelivery.upsert.mock.calls.find(
      (c: any) => c[0].create.channel === 'IN_APP',
    );
    expect(
      inAppCall[0].where.notification_deliveries_notification_channel_unique,
    ).toEqual({
      notificationId: 'notif-1',
      channel: 'IN_APP',
    });
    expect(inAppCall[0].create.attemptCount).toBe(3);
  });

  it('records a FAILED provider result with its failureReason', async () => {
    prisma.pushDevice.findFirst.mockResolvedValue({ id: 'device-1' });
    inAppProvider.send.mockResolvedValue({
      status: 'FAILED',
      failureReason: 'downstream error',
    });

    await service.deliverAll(buildNotification());

    const inAppCall = prisma.notificationDelivery.upsert.mock.calls.find(
      (c: any) => c[0].create.channel === 'IN_APP',
    );
    expect(inAppCall[0].create.status).toBe('FAILED');
    expect(inAppCall[0].create.failureReason).toBe('downstream error');
  });
});
