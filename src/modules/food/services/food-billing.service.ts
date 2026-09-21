import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FoodSubscriptionInvoice,
  FoodSubscriptionPayment,
  Prisma,
  TenantFoodSubscription,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RazorpayConfig } from '../../../config/configuration';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../../payments/gateway/payment-gateway.interface';
import { decimalToSmallestUnit } from '../../payments/money.util';
import {
  addOneCalendarMonthUtc,
  addDaysUtc,
} from '../../subscriptions/subscription-period.util';
import { CreateFoodPaymentOrderDto } from '../dto/create-food-payment-order.dto';
import { VerifyFoodPaymentDto } from '../dto/verify-food-payment.dto';
import { FoodPaymentOrderResponseDto } from '../dto/food-payment-order-response.dto';
import { FoodPaymentResponseDto } from '../dto/food-payment-response.dto';
import { FoodSubscriptionInvoiceResponseDto } from '../dto/food-subscription-invoice-response.dto';

const PAYABLE_INVOICE_STATUSES = ['ISSUED', 'OVERDUE'];

// The Phase 10 counterpart to Phase 7's SubscriptionPaymentsService/
// SubscriptionInvoicesService, deliberately combined into one class (this
// domain is simpler - no TRIAL/GRACE_PERIOD state machine, just "generate
// a monthly invoice, take a payment against it"). Never reuses Phase 6's
// Payment or Phase 7's SubscriptionPayment (spec sections 4-5) - its own
// FoodSubscriptionInvoice/FoodSubscriptionPayment tables only, and never
// creates a PaymentAllocation/OwnerSettlement (spec section 46).
@Injectable()
export class FoodBillingService {
  private readonly logger = new Logger(FoodBillingService.name);
  private readonly razorpayKeyId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    configService: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {
    this.razorpayKeyId = configService.get<RazorpayConfig>('razorpay')!.keyId!;
  }

  // The one and only food-invoice creation path - called by
  // FoodSubscriptionsService.subscribe (first period) and by
  // evaluateRenewal (subsequent periods), never by a client-facing
  // endpoint directly (spec: system-generated, like Phase 7's SaaS
  // invoices). `subtotal`/`total` snapshot `subscription.priceSnapshot`,
  // never a live `FoodPlan.price` re-read.
  async generateInvoiceForPeriod(
    subscription: TenantFoodSubscription,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<FoodSubscriptionInvoice> {
    const tax = new Prisma.Decimal(0);
    const total = subscription.priceSnapshot.plus(tax);
    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.prisma.foodSubscriptionInvoice.create({
      data: {
        organizationId: subscription.organizationId,
        propertyId: subscription.propertyId,
        tenantId: subscription.tenantId,
        residencyId: subscription.residencyId,
        foodSubscriptionId: subscription.id,
        invoiceNumber,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        subtotal: subscription.priceSnapshot,
        tax,
        total,
        currency: subscription.currency,
        status: 'ISSUED',
        issuedAt: new Date(),
        dueAt: periodEnd,
      },
    });
    this.logger.log(
      `FOOD_INVOICE_GENERATED invoice=${invoice.id} subscription=${subscription.id} number=${invoiceNumber}`,
    );
    return invoice;
  }

  // Lazy renewal (no cron infrastructure, same convention as Phase 5's
  // evaluateOverdue / Phase 7's evaluateLifecycle): called whenever a
  // caller reads this subscription's invoices - if the subscription is
  // still ACTIVE and the latest invoice's period has fully elapsed,
  // generate the next month's invoice. A PAUSED/CANCELLED/EXPIRED
  // subscription never gets a new invoice (spec section 49/78).
  async evaluateRenewal(subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.tenantFoodSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription || subscription.status !== 'ACTIVE') {
      return;
    }
    const latestInvoice = await this.prisma.foodSubscriptionInvoice.findFirst({
      where: { foodSubscriptionId: subscriptionId },
      orderBy: { billingPeriodEnd: 'desc' },
    });
    const now = new Date();
    if (!latestInvoice) {
      const periodEnd = addDaysUtc(
        addOneCalendarMonthUtc(subscription.startDate),
        -1,
      );
      await this.generateInvoiceForPeriod(
        subscription,
        subscription.startDate,
        periodEnd,
      );
      return;
    }
    if (now <= latestInvoice.billingPeriodEnd) {
      return;
    }
    const periodStart = addDaysUtc(latestInvoice.billingPeriodEnd, 1);
    const periodEnd = addDaysUtc(addOneCalendarMonthUtc(periodStart), -1);
    try {
      await this.generateInvoiceForPeriod(subscription, periodStart, periodEnd);
    } catch (error) {
      // Two concurrent evaluations racing to generate the same period -
      // the unique constraint (foodSubscriptionId, billingPeriodStart,
      // billingPeriodEnd) rejects the loser; safe to swallow since the
      // winner's row already satisfies the caller.
      if (
        !this.isUniqueViolation(error, [
          'food_subscription_invoices_period_unique',
        ])
      ) {
        throw error;
      }
    }
  }

  async findInvoicesForTenant(
    user: AuthenticatedUser,
  ): Promise<FoodSubscriptionInvoiceResponseDto[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    if (!tenant) {
      return [];
    }
    const subscriptions = await this.prisma.tenantFoodSubscription.findMany({
      where: { tenantId: tenant.id },
      select: { id: true },
    });
    for (const sub of subscriptions) {
      await this.evaluateRenewal(sub.id);
    }
    const invoices = await this.prisma.foodSubscriptionInvoice.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(FoodSubscriptionInvoiceResponseDto.fromEntity);
  }

  async getAccessibleInvoiceOrThrow(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<FoodSubscriptionInvoice> {
    const invoice = await this.prisma.foodSubscriptionInvoice.findFirst({
      where: { id: invoiceId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!invoice) {
      throw this.invoiceNotFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return invoice;
    }
    if (invoice.tenant.userId === user.id) {
      return invoice;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      invoice.organizationId,
    );
    if (membership) {
      return invoice;
    }
    throw this.invoiceNotFound();
  }

  // Payable by the tenant themselves (or OWNER/MANAGER paying on their
  // behalf) - the amount is always `FoodSubscriptionInvoice.total`, read
  // from the database, never client-supplied.
  async createOrder(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreateFoodPaymentOrderDto,
  ): Promise<FoodPaymentOrderResponseDto> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.foodSubscriptionPayment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        if (existing.foodSubscriptionInvoiceId !== invoiceId) {
          throw new AppException(
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
            'This idempotency key was already used for a different invoice.',
            HttpStatus.CONFLICT,
          );
        }
        return this.toOrderResponse(existing);
      }
    }

    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new AppException(
        ErrorCode.FOOD_INVOICE_NOT_PAYABLE,
        `A food invoice with status ${invoice.status} cannot be paid.`,
        HttpStatus.CONFLICT,
      );
    }

    let payment: FoodSubscriptionPayment;
    try {
      payment = await this.prisma.foodSubscriptionPayment.create({
        data: {
          organizationId: invoice.organizationId,
          propertyId: invoice.propertyId,
          tenantId: invoice.tenantId,
          residencyId: invoice.residencyId,
          foodSubscriptionId: invoice.foodSubscriptionId,
          foodSubscriptionInvoiceId: invoice.id,
          amount: invoice.total,
          currency: invoice.currency,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });
    } catch (error) {
      if (
        dto.idempotencyKey &&
        this.isUniqueViolation(error, ['idempotencyKey'])
      ) {
        const existing = await this.prisma.foodSubscriptionPayment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          return this.toOrderResponse(existing);
        }
      }
      throw error;
    }

    const order = await this.gateway.createOrder({
      amountInSmallestUnit: decimalToSmallestUnit(invoice.total),
      currency: invoice.currency,
      receipt: payment.id,
      notes: {
        foodSubscriptionInvoiceId: invoice.id,
        organizationId: invoice.organizationId,
      },
    });

    payment = await this.prisma.foodSubscriptionPayment.update({
      where: { id: payment.id },
      data: { providerOrderId: order.providerOrderId, status: 'PENDING' },
    });

    this.logger.log(
      `FOOD_PAYMENT_ORDER_CREATED payment=${payment.id} invoice=${invoiceId} order=${order.providerOrderId} by=${user.id}`,
    );
    return this.toOrderResponse(payment);
  }

  async verifyPayment(
    user: AuthenticatedUser,
    paymentId: string,
    dto: VerifyFoodPaymentDto,
  ): Promise<FoodPaymentResponseDto> {
    const payment = await this.getAccessiblePaymentOrThrow(user, paymentId);

    if (payment.providerOrderId !== dto.razorpayOrderId) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'razorpayOrderId does not match this payment.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isValid = this.gateway.verifyPaymentSignature({
      providerOrderId: dto.razorpayOrderId,
      providerPaymentId: dto.razorpayPaymentId,
      signature: dto.razorpaySignature,
    });
    if (!isValid) {
      await this.prisma.foodSubscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: 'INVALID_SIGNATURE',
          failureMessage: 'Payment signature verification failed.',
        },
      });
      throw new AppException(
        ErrorCode.FOOD_PAYMENT_VERIFICATION_FAILED,
        'Payment signature verification failed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const gatewayPayment = await this.gateway.fetchPayment(
      dto.razorpayPaymentId,
    );
    if (gatewayPayment.status !== 'captured') {
      const updated = await this.prisma.foodSubscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: 'AUTHORIZED',
          providerPaymentId: dto.razorpayPaymentId,
        },
      });
      return FoodPaymentResponseDto.fromEntity(updated);
    }

    const finalized = await this.finalizeCapturedPayment(
      payment.id,
      dto.razorpayPaymentId,
    );
    return FoodPaymentResponseDto.fromEntity(finalized);
  }

  // The critical transaction, mirroring SubscriptionPaymentsService's own
  // exactly: lock the invoice row first (the "aggregate invariant needs a
  // lock, not a unique index" reasoning - "an invoice is marked PAID at
  // most once"), idempotent against either arrival order (client-side
  // verify vs. server-side webhook).
  async finalizeCapturedPayment(
    paymentId: string,
    providerPaymentId: string,
  ): Promise<FoodSubscriptionPayment> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.foodSubscriptionPayment.findUnique({
        where: { id: paymentId },
      });
      if (!payment) {
        throw this.paymentNotFound();
      }
      if (payment.status === 'CAPTURED') {
        return payment;
      }

      await tx.$queryRaw`SELECT id FROM food_subscription_invoices WHERE id = ${payment.foodSubscriptionInvoiceId} FOR UPDATE`;
      const invoice = await tx.foodSubscriptionInvoice.findUniqueOrThrow({
        where: { id: payment.foodSubscriptionInvoiceId },
      });

      if (invoice.status === 'PAID' || invoice.status === 'VOID') {
        return tx.foodSubscriptionPayment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            providerPaymentId,
            failureCode: 'ALREADY_PROCESSED',
            failureMessage:
              'This food invoice was already finalized by another payment.',
          },
        });
      }

      const captured = await tx.foodSubscriptionPayment.update({
        where: { id: paymentId },
        data: { status: 'CAPTURED', capturedAt: new Date(), providerPaymentId },
      });
      await tx.foodSubscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      this.logger.log(
        `FOOD_PAYMENT_CAPTURED payment=${paymentId} invoice=${invoice.id} organization=${payment.organizationId}`,
      );
      return captured;
    });
  }

  async findByProviderOrderId(
    providerOrderId: string,
  ): Promise<FoodSubscriptionPayment | null> {
    return this.prisma.foodSubscriptionPayment.findUnique({
      where: { providerOrderId },
    });
  }

  async getAccessiblePaymentOrThrow(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<FoodSubscriptionPayment> {
    const payment = await this.prisma.foodSubscriptionPayment.findFirst({
      where: { id: paymentId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!payment) {
      throw this.paymentNotFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return payment;
    }
    if (payment.tenant.userId === user.id) {
      return payment;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      payment.organizationId,
    );
    if (membership) {
      return payment;
    }
    throw this.paymentNotFound();
  }

  private async generateInvoiceNumber(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ nextval: bigint | string }[]>`
      SELECT nextval('food_invoice_number_seq') AS nextval
    `;
    const sequenceValue = String(rows[0].nextval);
    const year = new Date().getUTCFullYear();
    return `FOOD-${year}-${sequenceValue.padStart(6, '0')}`;
  }

  private toOrderResponse(
    payment: FoodSubscriptionPayment,
  ): FoodPaymentOrderResponseDto {
    const dto = new FoodPaymentOrderResponseDto();
    dto.foodSubscriptionPaymentId = payment.id;
    dto.providerOrderId = payment.providerOrderId ?? '';
    dto.amountInSmallestUnit = decimalToSmallestUnit(payment.amount);
    dto.amount = payment.amount.toString();
    dto.currency = payment.currency;
    dto.keyId = this.razorpayKeyId;
    return dto;
  }

  private invoiceNotFound(): AppException {
    return new AppException(
      ErrorCode.FOOD_INVOICE_NOT_FOUND,
      'Food invoice not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private paymentNotFound(): AppException {
    return new AppException(
      ErrorCode.FOOD_PAYMENT_NOT_FOUND,
      'Food payment not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private isUniqueViolation(error: unknown, candidates: string[]): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return candidates.some((c) => target === c || target.includes(c));
    }
    if (Array.isArray(target)) {
      return candidates.some((c) => target.includes(c));
    }
    return false;
  }
}
