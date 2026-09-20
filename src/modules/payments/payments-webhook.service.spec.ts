import { Prisma } from '@prisma/client';
import { PaymentGateway } from './gateway/payment-gateway.interface';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { ErrorCode } from '../../common/constants/error-code.enum';

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

function capturedPayload(overrides: Partial<any> = {}) {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_xyz',
          order_id: 'order_abc',
          method: 'upi',
          ...overrides,
        },
      },
    },
  };
}

describe('PaymentsWebhookService', () => {
  let service: PaymentsWebhookService;
  let prisma: any;
  let paymentsService: { finalizeCapturedPayment: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;

  beforeEach(() => {
    prisma = {
      webhookEvent: { create: jest.fn(), update: jest.fn() },
      payment: { findUnique: jest.fn(), update: jest.fn() },
    };
    paymentsService = { finalizeCapturedPayment: jest.fn() };
    gateway = {
      createOrder: jest.fn(),
      verifyPaymentSignature: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      fetchPayment: jest.fn(),
      createTransfer: jest.fn(),
      refundPayment: jest.fn(),
    };
    service = new PaymentsWebhookService(
      prisma,
      paymentsService as unknown as PaymentsService,
      gateway,
    );
  });

  it('rejects a webhook with an invalid signature before touching the database', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      service.processRazorpayWebhook(
        Buffer.from('{}'),
        'bad-sig',
        capturedPayload(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_WEBHOOK_SIGNATURE });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('finalizes the matching payment on a verified payment.captured event', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
    });

    await service.processRazorpayWebhook(
      Buffer.from('{}'),
      'good-sig',
      capturedPayload(),
      'evt_1',
    );

    expect(paymentsService.finalizeCapturedPayment).toHaveBeenCalledWith(
      'pay-1',
      'pay_xyz',
      'upi',
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('is idempotent: a duplicate (provider, eventId) delivery is ignored without re-finalizing', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    prisma.webhookEvent.create.mockRejectedValue(
      p2002('webhook_events_provider_event_unique'),
    );

    await service.processRazorpayWebhook(
      Buffer.from('{}'),
      'good-sig',
      capturedPayload(),
      'evt_1',
    );

    expect(paymentsService.finalizeCapturedPayment).not.toHaveBeenCalled();
  });

  it('marks a payment FAILED on a verified payment.failed event', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-2' });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
    });

    await service.processRazorpayWebhook(
      Buffer.from('{}'),
      'good-sig',
      {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_xyz',
              order_id: 'order_abc',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Card declined',
            },
          },
        },
      },
      'evt_2',
    );

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureCode: 'BAD_REQUEST_ERROR',
      }),
    });
  });

  it('safely ignores an event for an order it has no matching internal payment for', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-3' });
    prisma.payment.findUnique.mockResolvedValue(null);

    await service.processRazorpayWebhook(
      Buffer.from('{}'),
      'good-sig',
      capturedPayload({ order_id: 'order_unknown' }),
      'evt_3',
    );

    expect(paymentsService.finalizeCapturedPayment).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalled();
  });
});
