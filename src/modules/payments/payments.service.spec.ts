import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PlatformFeeService } from './platform-fee.service';
import { PaymentGateway } from './gateway/payment-gateway.interface';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { PaymentsService } from './payments.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'tenant-user-1',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

function buildInvoiceRow(overrides: Partial<any> = {}) {
  return {
    id: 'inv-1',
    residencyId: 'res-1',
    currency: 'INR',
    total: new Prisma.Decimal('10000.00'),
    status: 'ISSUED',
    dueDate: new Date('2027-02-05T00:00:00.000Z'),
    residency: {
      id: 'res-1',
      propertyId: 'prop-1',
      tenant: { id: 'tenant-1', userId: 'tenant-user-1' },
      property: { organizationId: 'org-1' },
    },
    ...overrides,
  };
}

function buildPaymentRow(overrides: Partial<any> = {}) {
  return {
    id: 'pay-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    residencyId: 'res-1',
    invoiceId: 'inv-1',
    payerUserId: 'tenant-user-1',
    amount: new Prisma.Decimal('4000.00'),
    currency: 'INR',
    platformFee: new Prisma.Decimal('1.00'),
    ownerSettlementAmount: new Prisma.Decimal('3999.00'),
    method: null,
    status: 'CREATED',
    provider: 'RAZORPAY',
    providerOrderId: 'order_abc',
    providerPaymentId: null,
    idempotencyKey: null,
    failureCode: null,
    failureMessage: null,
    paidAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let platformFee: { calculateFee: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;
  let configService: { get: jest.Mock };
  let eventBus: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      invoice: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      paymentAllocation: {
        aggregate: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ownerPaymentAccount: { findUnique: jest.fn() },
      ownerSettlement: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refund: { aggregate: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = {
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    platformFee = { calculateFee: jest.fn() };
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
        keyId: 'rzp_test_key',
        keySecret: 'secret',
        webhookSecret: 'whsec',
      }),
    };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentsService(
      prisma,
      memberships as unknown as MembershipsService,
      platformFee as unknown as PlatformFeeService,
      eventBus as unknown as DomainEventBusService,
      configService as any,
      gateway,
    );
  });

  describe('createOrder', () => {
    it('creates a payment and gateway order for a valid partial payment', async () => {
      prisma.invoice.findFirst.mockResolvedValue(buildInvoiceRow());
      prisma.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      platformFee.calculateFee.mockResolvedValue(new Prisma.Decimal('1.00'));
      prisma.payment.create.mockResolvedValue(
        buildPaymentRow({ providerOrderId: null, status: 'CREATED' }),
      );
      gateway.createOrder.mockResolvedValue({ providerOrderId: 'order_abc' });
      prisma.payment.update.mockResolvedValue(buildPaymentRow());

      const result = await service.createOrder(buildUser(), 'inv-1', {
        amount: '4000.00',
      });

      expect(gateway.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amountInSmallestUnit: 400000,
          currency: 'INR',
        }),
      );
      expect(result.providerOrderId).toBe('order_abc');
      expect(result.amount).toBe('4000');
    });

    it('rejects a non-tenant caller (BOLA)', async () => {
      prisma.invoice.findFirst.mockResolvedValue(buildInvoiceRow());

      await expect(
        service.createOrder(buildUser({ id: 'someone-else' }), 'inv-1', {
          amount: '4000.00',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVOICE_NOT_FOUND });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects paying a DRAFT invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue(
        buildInvoiceRow({ status: 'DRAFT' }),
      );

      await expect(
        service.createOrder(buildUser(), 'inv-1', { amount: '4000.00' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVOICE_NOT_PAYABLE });
    });

    it('rejects an amount exceeding the outstanding balance', async () => {
      prisma.invoice.findFirst.mockResolvedValue(buildInvoiceRow());
      prisma.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('9000.00') },
      });

      await expect(
        service.createOrder(buildUser(), 'inv-1', { amount: '4000.00' }),
      ).rejects.toMatchObject({
        code: ErrorCode.AMOUNT_EXCEEDS_OUTSTANDING_BALANCE,
      });
    });

    it('returns the existing order for a repeated Idempotency-Key instead of creating a new one', async () => {
      const existing = buildPaymentRow({ idempotencyKey: 'idem-1' });
      prisma.payment.findUnique.mockResolvedValue(existing);

      const result = await service.createOrder(
        buildUser(),
        'inv-1',
        { amount: '4000.00' },
        'idem-1',
      );

      expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
      expect(gateway.createOrder).not.toHaveBeenCalled();
      expect(result.providerOrderId).toBe(existing.providerOrderId);
    });

    it('translates a concurrent-creation unique violation on idempotencyKey into the existing payment', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce(null) // pre-check: none yet
        .mockResolvedValueOnce(buildPaymentRow({ idempotencyKey: 'idem-2' })); // after race lost
      prisma.invoice.findFirst.mockResolvedValue(buildInvoiceRow());
      prisma.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      platformFee.calculateFee.mockResolvedValue(new Prisma.Decimal('1.00'));
      prisma.payment.create.mockRejectedValue(p2002('idempotencyKey'));

      const result = await service.createOrder(
        buildUser(),
        'inv-1',
        { amount: '4000.00' },
        'idem-2',
      );

      expect(result.providerOrderId).toBe('order_abc');
      expect(gateway.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('finalizeCapturedPayment', () => {
    function mockTx(overrides: Partial<any> = {}) {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        payment: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        invoice: {
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        paymentAllocation: {
          aggregate: jest.fn(),
          create: jest.fn(),
        },
        ownerPaymentAccount: { findUnique: jest.fn().mockResolvedValue(null) },
        ownerSettlement: { create: jest.fn() },
        ...overrides,
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('allocates the payment and marks the invoice PAID when it fully covers the balance', async () => {
      const tx = mockTx();
      tx.payment.findUnique.mockResolvedValue(
        buildPaymentRow({ amount: new Prisma.Decimal('10000.00') }),
      );
      tx.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoiceRow());
      tx.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      tx.payment.update.mockResolvedValue(
        buildPaymentRow({ status: 'CAPTURED' }),
      );

      const result = await service.finalizeCapturedPayment(
        'pay-1',
        'pay_xyz',
        'upi',
      );

      expect(tx.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          amount: new Prisma.Decimal('10000.00'),
        },
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PAID' },
      });
      expect(tx.ownerSettlement.create).toHaveBeenCalled();
      expect(result.status).toBe('CAPTURED');
    });

    it('marks the invoice PARTIALLY_PAID when the payment only covers part of the balance', async () => {
      const tx = mockTx();
      tx.payment.findUnique.mockResolvedValue(
        buildPaymentRow({ amount: new Prisma.Decimal('4000.00') }),
      );
      tx.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoiceRow());
      tx.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      tx.payment.update.mockResolvedValue(
        buildPaymentRow({ status: 'CAPTURED' }),
      );

      await service.finalizeCapturedPayment('pay-1', 'pay_xyz');

      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PARTIALLY_PAID' },
      });
    });

    it('is idempotent - a payment already CAPTURED short-circuits without re-allocating', async () => {
      const tx = mockTx();
      tx.payment.findUnique.mockResolvedValue(
        buildPaymentRow({ status: 'CAPTURED' }),
      );

      const result = await service.finalizeCapturedPayment('pay-1', 'pay_xyz');

      expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
      expect(result.status).toBe('CAPTURED');
    });

    it('rejects (marks FAILED) a payment that would overpay an invoice whose balance is already settled - the concurrency guard', async () => {
      const tx = mockTx();
      tx.payment.findUnique.mockResolvedValue(
        buildPaymentRow({ amount: new Prisma.Decimal('5000.00') }),
      );
      tx.invoice.findUniqueOrThrow.mockResolvedValue(
        buildInvoiceRow({ total: new Prisma.Decimal('5000.00') }),
      );
      // Another payment already allocated the full balance under the lock.
      tx.paymentAllocation.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('5000.00') },
      });
      tx.payment.update.mockResolvedValue(
        buildPaymentRow({
          status: 'FAILED',
          failureCode: 'OVERPAYMENT_REJECTED',
        }),
      );

      const result = await service.finalizeCapturedPayment('pay-1', 'pay_xyz');

      expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            failureCode: 'OVERPAYMENT_REJECTED',
          }),
        }),
      );
      expect(result.status).toBe('FAILED');
    });
  });

  describe('verifyPayment', () => {
    it('rejects a mismatched providerOrderId', async () => {
      prisma.payment.findFirst.mockResolvedValue(buildPaymentRow());

      await expect(
        service.verifyPayment(buildUser(), 'pay-1', {
          razorpayOrderId: 'order_WRONG',
          razorpayPaymentId: 'pay_xyz',
          razorpaySignature: 'sig',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('marks the payment FAILED and rejects on an invalid signature', async () => {
      prisma.payment.findFirst.mockResolvedValue(buildPaymentRow());
      gateway.verifyPaymentSignature.mockReturnValue(false);
      prisma.payment.update.mockResolvedValue(
        buildPaymentRow({ status: 'FAILED' }),
      );

      await expect(
        service.verifyPayment(buildUser(), 'pay-1', {
          razorpayOrderId: 'order_abc',
          razorpayPaymentId: 'pay_xyz',
          razorpaySignature: 'bad-sig',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_GATEWAY_ERROR });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('rejects a caller who is not this payment’s payer (BOLA)', async () => {
      prisma.payment.findFirst.mockResolvedValue(buildPaymentRow());

      await expect(
        service.verifyPayment(buildUser({ id: 'someone-else' }), 'pay-1', {
          razorpayOrderId: 'order_abc',
          razorpayPaymentId: 'pay_xyz',
          razorpaySignature: 'sig',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOT_FOUND });
    });
  });

  describe('refund', () => {
    it('rejects a refund from a caller without OWNER/MANAGER role', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPaymentRow({ status: 'CAPTURED' }),
      );
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.refund(buildUser({ platformRole: 'USER' }), 'pay-1', {}),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });

    it('rejects refunding a payment that was never captured', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPaymentRow({ status: 'FAILED' }),
      );

      await expect(
        service.refund(buildUser(), 'pay-1', {}),
      ).rejects.toMatchObject({
        code: ErrorCode.REFUND_NOT_ALLOWED,
      });
    });
  });
});
