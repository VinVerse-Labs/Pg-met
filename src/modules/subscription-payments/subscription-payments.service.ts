import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubscriptionPayment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RazorpayConfig } from '../../config/configuration';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../payments/gateway/payment-gateway.interface';
import { decimalToSmallestUnit } from '../payments/money.util';
import { SubscriptionInvoicesService } from '../subscription-invoices/subscription-invoices.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { CreateSubscriptionPaymentOrderDto } from './dto/create-subscription-payment-order.dto';
import { VerifySubscriptionPaymentDto } from './dto/verify-subscription-payment.dto';
import { SubscriptionPaymentOrderResponseDto } from './dto/subscription-payment-order-response.dto';
import { SubscriptionPaymentResponseDto } from './dto/subscription-payment-response.dto';

const PAYABLE_INVOICE_STATUSES = ['ISSUED', 'OVERDUE'];

// The Phase 7 counterpart to Phase 6's PaymentsService - deliberately a
// separate class, not a generalization of it (spec: "do NOT reuse Phase 6
// Payment for SaaS payments"). Shares only the gateway abstraction
// (PAYMENT_GATEWAY, via PaymentGatewayModule) and the money-conversion
// util - everything else (models, authorization shape, no platform
// fee/settlement) is intentionally distinct. See README's "Phase 7"
// section for the full "two separate money flows" reasoning.
@Injectable()
export class SubscriptionPaymentsService {
  private readonly logger = new Logger(SubscriptionPaymentsService.name);
  private readonly razorpayKeyId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly subscriptionInvoices: SubscriptionInvoicesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly eventBus: DomainEventBusService,
    configService: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {
    this.razorpayKeyId = configService.get<RazorpayConfig>('razorpay')!.keyId!;
  }

  // OWNER-only (spec authorization section) - the invoice lookup itself
  // is BOLA-safe via SubscriptionInvoicesService.getAccessibleInvoiceOrThrow
  // (Phase 5/6's established "reuse the layer above" chain, extended into
  // Phase 7). The amount is always `SubscriptionInvoice.total`, read from
  // the database - never client-supplied.
  async createOrder(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreateSubscriptionPaymentOrderDto,
  ): Promise<SubscriptionPaymentOrderResponseDto> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.subscriptionPayment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        if (existing.subscriptionInvoiceId !== invoiceId) {
          throw new AppException(
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
            'This idempotency key was already used for a different invoice.',
            HttpStatus.CONFLICT,
          );
        }
        return this.toOrderResponse(existing);
      }
    }

    const invoice = await this.subscriptionInvoices.getAccessibleInvoiceOrThrow(
      user,
      invoiceId,
    );

    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_INVOICE_NOT_PAYABLE,
        `A subscription invoice with status ${invoice.status} cannot be paid.`,
        HttpStatus.CONFLICT,
      );
    }

    let payment: SubscriptionPayment;
    try {
      payment = await this.prisma.subscriptionPayment.create({
        data: {
          organizationId: invoice.organizationId,
          subscriptionId: invoice.subscriptionId,
          subscriptionInvoiceId: invoice.id,
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
        const existing = await this.prisma.subscriptionPayment.findUnique({
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
        subscriptionInvoiceId: invoice.id,
        organizationId: invoice.organizationId,
      },
    });

    payment = await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { providerOrderId: order.providerOrderId, status: 'PENDING' },
    });

    this.logger.log(
      `SUBSCRIPTION_PAYMENT_ORDER_CREATED payment=${payment.id} invoice=${invoiceId} order=${order.providerOrderId} by=${user.id}`,
    );
    return this.toOrderResponse(payment);
  }

  async verifyPayment(
    user: AuthenticatedUser,
    paymentId: string,
    dto: VerifySubscriptionPaymentDto,
  ): Promise<SubscriptionPaymentResponseDto> {
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
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: 'INVALID_SIGNATURE',
          failureMessage: 'Payment signature verification failed.',
        },
      });
      await this.eventBus.emit(
        NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
        { subscriptionPaymentId: payment.id },
      );
      throw new AppException(
        ErrorCode.SUBSCRIPTION_PAYMENT_VERIFICATION_FAILED,
        'Payment signature verification failed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const gatewayPayment = await this.gateway.fetchPayment(
      dto.razorpayPaymentId,
    );
    if (gatewayPayment.status !== 'captured') {
      const updated = await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: 'AUTHORIZED',
          providerPaymentId: dto.razorpayPaymentId,
        },
      });
      return SubscriptionPaymentResponseDto.fromEntity(updated);
    }

    const finalized = await this.finalizeCapturedPayment(
      payment.id,
      dto.razorpayPaymentId,
    );
    return SubscriptionPaymentResponseDto.fromEntity(finalized);
  }

  // The critical transaction (spec section "CRITICAL TRANSACTION"),
  // called from either verifyPayment (client-side path) or
  // PaymentsWebhookService (server-side path) - whichever arrives first
  // finalizes; the other is a safe no-op via the idempotency check below.
  //
  // Concurrency: locks the invoice row first (the same "aggregate
  // invariant needs a lock, not a unique index" reasoning as Phase 6's
  // PaymentsService.finalizeCapturedPayment - here the invariant is "an
  // invoice is marked PAID, and a subscription's period is extended, at
  // most once"), then locks the subscription row before extending its
  // period, matching the pseudocode's "lock SubscriptionInvoice ...
  // lock OrganizationSubscription" ordering exactly.
  async finalizeCapturedPayment(
    paymentId: string,
    providerPaymentId: string,
  ): Promise<SubscriptionPayment> {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
      });
      if (!payment) {
        throw new AppException(
          ErrorCode.SUBSCRIPTION_PAYMENT_NOT_FOUND,
          'Subscription payment not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (payment.status === 'CAPTURED') {
        return payment;
      }

      await tx.$queryRaw`SELECT id FROM subscription_invoices WHERE id = ${payment.subscriptionInvoiceId} FOR UPDATE`;
      const invoice = await tx.subscriptionInvoice.findUniqueOrThrow({
        where: { id: payment.subscriptionInvoiceId },
      });

      if (invoice.status === 'PAID' || invoice.status === 'VOID') {
        return tx.subscriptionPayment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            providerPaymentId,
            failureCode: 'ALREADY_PROCESSED',
            failureMessage:
              'This subscription invoice was already finalized by another payment.',
          },
        });
      }

      const captured = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: { status: 'CAPTURED', capturedAt: new Date(), providerPaymentId },
      });
      await tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      await tx.$queryRaw`SELECT id FROM organization_subscriptions WHERE id = ${payment.subscriptionId} FOR UPDATE`;
      await this.subscriptionsService.activateFromPayment(
        tx,
        payment.subscriptionId,
        invoice.billingPeriodStart,
        invoice.billingPeriodEnd,
      );

      this.logger.log(
        `SUBSCRIPTION_PAYMENT_CAPTURED payment=${paymentId} invoice=${invoice.id} organization=${payment.organizationId}`,
      );
      return captured;
    });

    if (result.status === 'CAPTURED') {
      await this.eventBus.emit(
        NotificationType.SAAS_SUBSCRIPTION_PAYMENT_SUCCESS,
        { subscriptionPaymentId: paymentId },
      );
    } else if (result.status === 'FAILED') {
      await this.eventBus.emit(
        NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
        { subscriptionPaymentId: paymentId },
      );
    }
    return result;
  }

  async findForOrganization(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<SubscriptionPaymentResponseDto[]> {
    await this.assertOwner(user, organizationId);
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(SubscriptionPaymentResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<SubscriptionPaymentResponseDto> {
    const payment = await this.getAccessiblePaymentOrThrow(user, paymentId);
    return SubscriptionPaymentResponseDto.fromEntity(payment);
  }

  // BOLA-safe lookup by providerOrderId, used by
  // PaymentsWebhookService to dispatch a webhook event to this domain
  // instead of Phase 6's tenant-rent one - no authorization check here,
  // since a webhook call carries no caller identity to check against
  // (see PaymentsWebhookService for the signature-verification gate that
  // stands in for it).
  async findByProviderOrderId(
    providerOrderId: string,
  ): Promise<SubscriptionPayment | null> {
    return this.prisma.subscriptionPayment.findUnique({
      where: { providerOrderId },
    });
  }

  private async getAccessiblePaymentOrThrow(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<SubscriptionPayment> {
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { id: paymentId },
    });
    if (!payment) {
      throw this.paymentNotFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return payment;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      payment.organizationId,
    );
    if (!membership || membership.role !== 'OWNER') {
      throw this.paymentNotFound();
    }
    return payment;
  }

  private async assertOwner(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const { membership } = await this.memberships.assertOrganizationAccess(
      user,
      organizationId,
    );
    this.memberships.assertRole(user, membership, ['OWNER']);
  }

  private toOrderResponse(
    payment: SubscriptionPayment,
  ): SubscriptionPaymentOrderResponseDto {
    const dto = new SubscriptionPaymentOrderResponseDto();
    dto.subscriptionPaymentId = payment.id;
    dto.providerOrderId = payment.providerOrderId ?? '';
    dto.amountInSmallestUnit = decimalToSmallestUnit(payment.amount);
    dto.amount = payment.amount.toString();
    dto.currency = payment.currency;
    dto.keyId = this.razorpayKeyId;
    return dto;
  }

  private paymentNotFound(): AppException {
    return new AppException(
      ErrorCode.SUBSCRIPTION_PAYMENT_NOT_FOUND,
      'Subscription payment not found.',
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
