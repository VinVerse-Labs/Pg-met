import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { SubscriptionInvoicesService } from '../subscription-invoices/subscription-invoices.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentGateway } from '../payments/gateway/payment-gateway.interface';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { SubscriptionPaymentsService } from './subscription-payments.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'owner-1',
    name: 'Owner',
    email: 'owner@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildInvoice(overrides: Partial<any> = {}) {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    subscriptionId: 'sub-1',
    total: new Prisma.Decimal('499.00'),
    currency: 'INR',
    status: 'ISSUED',
    billingPeriodStart: new Date('2026-09-20'),
    billingPeriodEnd: new Date('2026-10-19'),
    ...overrides,
  };
}

function buildPayment(overrides: Partial<any> = {}) {
  return {
    id: 'sub-pay-1',
    organizationId: 'org-1',
    subscriptionId: 'sub-1',
    subscriptionInvoiceId: 'inv-1',
    amount: new Prisma.Decimal('499.00'),
    currency: 'INR',
    provider: 'RAZORPAY',
    status: 'CREATED',
    providerOrderId: 'order_abc',
    providerPaymentId: null,
    idempotencyKey: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SubscriptionPaymentsService', () => {
  let service: SubscriptionPaymentsService;
  let prisma: any;
  let memberships: {
    getActiveMembership: jest.Mock;
    assertOrganizationAccess: jest.Mock;
    assertRole: jest.Mock;
  };
  let subscriptionInvoices: { getAccessibleInvoiceOrThrow: jest.Mock };
  let subscriptionsService: { activateFromPayment: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;
  let configService: any;
  let eventBus: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      subscriptionPayment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscriptionInvoice: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = {
      getActiveMembership: jest.fn(),
      assertOrganizationAccess: jest.fn(),
      assertRole: jest.fn(),
    };
    subscriptionInvoices = { getAccessibleInvoiceOrThrow: jest.fn() };
    subscriptionsService = { activateFromPayment: jest.fn() };
    gateway = {
      createOrder: jest.fn(),
      verifyPaymentSignature: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      fetchPayment: jest.fn(),
      createTransfer: jest.fn(),
      refundPayment: jest.fn(),
    };
    configService = {
      get: jest.fn().mockReturnValue({
        keyId: 'rzp_test',
        keySecret: 'x',
        webhookSecret: 'y',
      }),
    };

    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new SubscriptionPaymentsService(
      prisma,
      memberships as unknown as MembershipsService,
      subscriptionInvoices as unknown as SubscriptionInvoicesService,
      subscriptionsService as unknown as SubscriptionsService,
      eventBus as unknown as DomainEventBusService,
      configService,
      gateway,
    );
  });

  describe('createOrder', () => {
    it('creates a payment for the invoice’s own total - never a client-supplied amount', async () => {
      subscriptionInvoices.getAccessibleInvoiceOrThrow.mockResolvedValue(
        buildInvoice(),
      );
      prisma.subscriptionPayment.create.mockResolvedValue(
        buildPayment({ providerOrderId: null }),
      );
      gateway.createOrder.mockResolvedValue({ providerOrderId: 'order_abc' });
      prisma.subscriptionPayment.update.mockResolvedValue(buildPayment());

      const result = await service.createOrder(buildUser(), 'inv-1', {});

      expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: expect.any(Prisma.Decimal) }),
        }),
      );
      expect(gateway.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountInSmallestUnit: 49900 }),
      );
      expect(result.amount).toBe('499');
    });

    it('rejects an already-PAID invoice', async () => {
      subscriptionInvoices.getAccessibleInvoiceOrThrow.mockResolvedValue(
        buildInvoice({ status: 'PAID' }),
      );

      await expect(
        service.createOrder(buildUser(), 'inv-1', {}),
      ).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INVOICE_NOT_PAYABLE,
      });
    });

    it('returns the existing order for a repeated idempotencyKey', async () => {
      const existing = buildPayment({
        idempotencyKey: 'idem-1',
        subscriptionInvoiceId: 'inv-1',
      });
      prisma.subscriptionPayment.findUnique.mockResolvedValue(existing);

      const result = await service.createOrder(buildUser(), 'inv-1', {
        idempotencyKey: 'idem-1',
      });

      expect(
        subscriptionInvoices.getAccessibleInvoiceOrThrow,
      ).not.toHaveBeenCalled();
      expect(result.providerOrderId).toBe(existing.providerOrderId);
    });
  });

  describe('finalizeCapturedPayment', () => {
    function mockTx(overrides: Partial<any> = {}) {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        subscriptionPayment: { findUnique: jest.fn(), update: jest.fn() },
        subscriptionInvoice: {
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        ...overrides,
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('marks the invoice PAID and activates the subscription', async () => {
      const tx = mockTx();
      tx.subscriptionPayment.findUnique.mockResolvedValue(buildPayment());
      tx.subscriptionInvoice.findUniqueOrThrow.mockResolvedValue(
        buildInvoice(),
      );
      tx.subscriptionPayment.update.mockResolvedValue(
        buildPayment({ status: 'CAPTURED' }),
      );

      const result = await service.finalizeCapturedPayment(
        'sub-pay-1',
        'pay_xyz',
      );

      expect(tx.subscriptionInvoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(subscriptionsService.activateFromPayment).toHaveBeenCalledWith(
        tx,
        'sub-1',
        expect.any(Date),
        expect.any(Date),
      );
      expect(result.status).toBe('CAPTURED');
    });

    it('is idempotent - an already-CAPTURED payment short-circuits', async () => {
      const tx = mockTx();
      tx.subscriptionPayment.findUnique.mockResolvedValue(
        buildPayment({ status: 'CAPTURED' }),
      );

      const result = await service.finalizeCapturedPayment(
        'sub-pay-1',
        'pay_xyz',
      );

      expect(tx.subscriptionInvoice.update).not.toHaveBeenCalled();
      expect(subscriptionsService.activateFromPayment).not.toHaveBeenCalled();
      expect(result.status).toBe('CAPTURED');
    });

    it('rejects (marks FAILED) a second payment racing against an already-PAID invoice', async () => {
      const tx = mockTx();
      tx.subscriptionPayment.findUnique.mockResolvedValue(
        buildPayment({ id: 'sub-pay-2' }),
      );
      tx.subscriptionInvoice.findUniqueOrThrow.mockResolvedValue(
        buildInvoice({ status: 'PAID' }),
      );
      tx.subscriptionPayment.update.mockResolvedValue(
        buildPayment({
          id: 'sub-pay-2',
          status: 'FAILED',
          failureCode: 'ALREADY_PROCESSED',
        }),
      );

      const result = await service.finalizeCapturedPayment(
        'sub-pay-2',
        'pay_xyz',
      );

      expect(subscriptionsService.activateFromPayment).not.toHaveBeenCalled();
      expect(result.status).toBe('FAILED');
    });
  });

  describe('authorization', () => {
    it('rejects a non-OWNER caller viewing a payment (BOLA-adjacent role check)', async () => {
      prisma.subscriptionPayment.findFirst.mockResolvedValue(buildPayment());
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });

      await expect(
        service.findOne(buildUser({ id: 'someone-else' }), 'sub-pay-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_PAYMENT_NOT_FOUND,
      });
    });
  });
});
