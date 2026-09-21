import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PaymentGateway } from '../../payments/gateway/payment-gateway.interface';
import { FoodBillingService } from './food-billing.service';

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

function buildInvoice(overrides: Partial<any> = {}) {
  return {
    id: 'invoice-1',
    organizationId: 'org-1',
    foodSubscriptionId: 'sub-1',
    total: new Prisma.Decimal('2500.00'),
    currency: 'INR',
    status: 'ISSUED',
    tenant: { userId: 'user-1' },
    ...overrides,
  };
}

describe('FoodBillingService', () => {
  let service: FoodBillingService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let gateway: jest.Mocked<PaymentGateway>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      foodSubscriptionPayment: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      foodSubscriptionInvoice: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      tenantFoodSubscription: { findUnique: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1 }]),
      $transaction: jest.fn(),
    };
    memberships = { getActiveMembership: jest.fn() };
    gateway = {
      createOrder: jest.fn(),
      verifyPaymentSignature: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      fetchPayment: jest.fn(),
      createTransfer: jest.fn(),
      refundPayment: jest.fn(),
    };
    configService = {
      get: jest.fn().mockReturnValue({ keyId: 'rzp_test_key' }),
    };

    service = new FoodBillingService(
      prisma,
      memberships as unknown as MembershipsService,
      configService as any,
      gateway,
    );
  });

  describe('generateInvoiceForPeriod', () => {
    it('snapshots the subscription’s priceSnapshot, never a live plan lookup', async () => {
      prisma.foodSubscriptionInvoice.create.mockResolvedValue({
        id: 'invoice-1',
      });
      const subscription = {
        id: 'sub-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        tenantId: 'tenant-1',
        residencyId: 'res-1',
        priceSnapshot: new Prisma.Decimal('2500.00'),
        currency: 'INR',
      };
      await service.generateInvoiceForPeriod(
        subscription as any,
        new Date('2027-01-01'),
        new Date('2027-01-31'),
      );
      expect(prisma.foodSubscriptionInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotal: subscription.priceSnapshot,
          }),
        }),
      );
    });
  });

  describe('evaluateRenewal', () => {
    it('does nothing for a non-ACTIVE subscription', async () => {
      prisma.tenantFoodSubscription.findUnique.mockResolvedValue({
        status: 'PAUSED',
      });
      await service.evaluateRenewal('sub-1');
      expect(prisma.foodSubscriptionInvoice.create).not.toHaveBeenCalled();
    });

    it('does nothing when the latest invoice period has not elapsed yet', async () => {
      prisma.tenantFoodSubscription.findUnique.mockResolvedValue({
        status: 'ACTIVE',
      });
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.foodSubscriptionInvoice.findFirst.mockResolvedValue({
        billingPeriodEnd: future,
      });
      await service.evaluateRenewal('sub-1');
      expect(prisma.foodSubscriptionInvoice.create).not.toHaveBeenCalled();
    });

    it('generates the next period’s invoice once the current one has elapsed', async () => {
      prisma.tenantFoodSubscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        tenantId: 'tenant-1',
        residencyId: 'res-1',
        priceSnapshot: new Prisma.Decimal('2500.00'),
        currency: 'INR',
      });
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma.foodSubscriptionInvoice.findFirst.mockResolvedValue({
        billingPeriodEnd: past,
      });
      prisma.foodSubscriptionInvoice.create.mockResolvedValue({
        id: 'invoice-2',
      });

      await service.evaluateRenewal('sub-1');
      expect(prisma.foodSubscriptionInvoice.create).toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    it('rejects creating an order for a non-payable invoice', async () => {
      prisma.foodSubscriptionInvoice.findFirst.mockResolvedValue(
        buildInvoice({ status: 'PAID' }),
      );

      await expect(
        service.createOrder(buildUser(), 'invoice-1', {}),
      ).rejects.toMatchObject({ code: ErrorCode.FOOD_INVOICE_NOT_PAYABLE });
    });

    it('creates a payment row and a gateway order for a payable invoice', async () => {
      prisma.foodSubscriptionInvoice.findFirst.mockResolvedValue(
        buildInvoice(),
      );
      prisma.foodSubscriptionPayment.create.mockResolvedValue({
        id: 'pay-1',
        amount: buildInvoice().total,
        currency: 'INR',
      });
      gateway.createOrder.mockResolvedValue({ providerOrderId: 'order_abc' });
      prisma.foodSubscriptionPayment.update.mockResolvedValue({
        id: 'pay-1',
        providerOrderId: 'order_abc',
        amount: buildInvoice().total,
        currency: 'INR',
      });

      const result = await service.createOrder(buildUser(), 'invoice-1', {});
      expect(result.providerOrderId).toBe('order_abc');
      expect(result.amount).toBe('2500');
    });
  });

  describe('finalizeCapturedPayment (concurrency-critical)', () => {
    function mockTx(invoiceStatus: string) {
      const tx = {
        foodSubscriptionPayment: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'pay-1',
            status: 'PENDING',
            foodSubscriptionInvoiceId: 'invoice-1',
          }),
          update: jest
            .fn()
            .mockImplementation(({ data }: any) => ({ id: 'pay-1', ...data })),
        },
        foodSubscriptionInvoice: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'invoice-1', status: invoiceStatus }),
          update: jest.fn(),
        },
        $queryRaw: jest.fn(),
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('marks the payment CAPTURED and the invoice PAID exactly once', async () => {
      const tx = mockTx('ISSUED');
      const result = await service.finalizeCapturedPayment(
        'pay-1',
        'razorpay-pay-1',
      );
      expect(result.status).toBe('CAPTURED');
      expect(tx.foodSubscriptionInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('a second finalize against an already-PAID invoice fails safely, not a duplicate PAID write', async () => {
      const tx = mockTx('PAID');
      const result = await service.finalizeCapturedPayment(
        'pay-1',
        'razorpay-pay-2',
      );
      expect(result.status).toBe('FAILED');
      expect(tx.foodSubscriptionInvoice.update).not.toHaveBeenCalled();
    });

    it('is idempotent against an already-CAPTURED payment (webhook + client verify both arriving)', async () => {
      const tx = {
        foodSubscriptionPayment: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'pay-1', status: 'CAPTURED' }),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.finalizeCapturedPayment(
        'pay-1',
        'razorpay-pay-1',
      );
      expect(result.status).toBe('CAPTURED');
    });
  });
});
