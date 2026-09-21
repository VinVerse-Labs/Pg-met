import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Invoice,
  OwnerSettlement,
  Payment,
  Prisma,
  Residency,
  Tenant,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RazorpayConfig } from '../../config/configuration';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './gateway/payment-gateway.interface';
import { PlatformFeeService } from './platform-fee.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { decimalToSmallestUnit } from './money.util';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentOrderResponseDto } from './dto/payment-order-response.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

// Invoice states a tenant may still pay against. DRAFT is not yet a real
// obligation (spec section 28 - the client never invents a payable
// invoice before OWNER/MANAGER issues it); VOID/PAID have nothing left
// to collect.
const PAYABLE_INVOICE_STATUSES = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

type InvoiceWithTenantAndOrg = Invoice & {
  residency: Residency & { tenant: Tenant; organizationId: string };
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly razorpayKeyId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly platformFee: PlatformFeeService,
    private readonly eventBus: DomainEventBusService,
    configService: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {
    this.razorpayKeyId = configService.get<RazorpayConfig>('razorpay')!.keyId!;
  }

  // The one and only order-creation path (spec section 28). Every
  // financial value here is server-calculated; the client names only how
  // much of the outstanding balance it intends to pay right now.
  async createOrder(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreatePaymentOrderDto,
    idempotencyKey?: string,
  ): Promise<PaymentOrderResponseDto> {
    if (idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (existing.invoiceId !== invoiceId) {
          throw new AppException(
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
            'This idempotency key was already used for a different invoice.',
            HttpStatus.CONFLICT,
          );
        }
        return this.toOrderResponse(existing);
      }
    }

    const invoice = await this.getInvoiceForPayerOrThrow(user, invoiceId);

    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new AppException(
        ErrorCode.INVOICE_NOT_PAYABLE,
        `An invoice with status ${invoice.status} cannot be paid.`,
        HttpStatus.CONFLICT,
      );
    }

    const requestedAmount = new Prisma.Decimal(dto.amount);
    if (requestedAmount.lessThanOrEqualTo(0)) {
      throw new AppException(
        ErrorCode.INVALID_PAYMENT_AMOUNT,
        'amount must be greater than zero.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const outstanding = await this.getOutstandingBalance(invoice);
    if (requestedAmount.greaterThan(outstanding)) {
      throw new AppException(
        ErrorCode.AMOUNT_EXCEEDS_OUTSTANDING_BALANCE,
        `Requested amount exceeds the outstanding balance of ${outstanding.toString()}.`,
        HttpStatus.CONFLICT,
      );
    }

    const platformFee = await this.platformFee.calculateFee(requestedAmount);
    const ownerSettlementAmount = requestedAmount.minus(platformFee);

    let payment: Payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          organizationId: invoice.residency.organizationId,
          propertyId: invoice.residency.propertyId,
          residencyId: invoice.residencyId,
          invoiceId: invoice.id,
          payerUserId: user.id,
          amount: requestedAmount,
          currency: invoice.currency,
          platformFee,
          ownerSettlementAmount,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
    } catch (error) {
      // A retried request racing itself under the same Idempotency-Key
      // (spec section 34) - the unique constraint is what actually
      // guarantees single-creation under concurrency; the pre-check above
      // is only the fast path.
      if (idempotencyKey && this.isUniqueViolation(error, 'idempotencyKey')) {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          return this.toOrderResponse(existing);
        }
      }
      throw error;
    }

    const order = await this.gateway.createOrder({
      amountInSmallestUnit: decimalToSmallestUnit(requestedAmount),
      currency: invoice.currency,
      receipt: payment.id,
      notes: { invoiceId: invoice.id, residencyId: invoice.residencyId },
    });

    payment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerOrderId: order.providerOrderId, status: 'PENDING' },
    });

    this.logger.log(
      `PAYMENT_ORDER_CREATED payment=${payment.id} invoice=${invoiceId} order=${order.providerOrderId} by=${user.id}`,
    );
    return this.toOrderResponse(payment);
  }

  // Client-side Razorpay Checkout verification (spec section 28) - an
  // independent server-side signature check, never trusting the client's
  // own "payment succeeded" callback. Idempotent with webhook processing:
  // whichever of the two arrives first actually finalizes the payment
  // (see finalizeCapturedPayment).
  async verifyPayment(
    user: AuthenticatedUser,
    paymentId: string,
    dto: VerifyPaymentDto,
  ): Promise<PaymentResponseDto> {
    const payment = await this.getPaymentForPayerOrThrow(user, paymentId);

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
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: 'INVALID_SIGNATURE',
          failureMessage: 'Payment signature verification failed.',
        },
      });
      await this.eventBus.emit(NotificationType.RENT_PAYMENT_FAILED, {
        paymentId: payment.id,
      });
      throw new AppException(
        ErrorCode.PAYMENT_GATEWAY_ERROR,
        'Payment signature verification failed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const gatewayPayment = await this.gateway.fetchPayment(
      dto.razorpayPaymentId,
    );
    if (gatewayPayment.status !== 'captured') {
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'AUTHORIZED',
          providerPaymentId: dto.razorpayPaymentId,
        },
      });
      return PaymentResponseDto.fromEntity(updated);
    }

    await this.finalizeCapturedPayment(
      payment.id,
      dto.razorpayPaymentId,
      gatewayPayment.method,
    );
    return this.findOne(user, payment.id);
  }

  // The webhook's finalization path (spec section 32) - see
  // PaymentsWebhookController for signature verification and
  // WebhookEvent-based delivery idempotency. Also called from
  // verifyPayment() above; both paths converge here and this method is
  // itself idempotent (a payment already CAPTURED is returned as-is).
  //
  // Concurrency (spec section 44): the invariant "sum of allocations for
  // an invoice never exceeds its total" cannot be expressed as a
  // Postgres uniqueness/exclusion constraint the way Phase 4/5's partial
  // unique indexes could (it's an aggregate over many rows, not a
  // conflict between two rows) - so this uses a pessimistic
  // `SELECT ... FOR UPDATE` on the invoice row instead, the same
  // locked-read-then-write technique RoomsService already uses for
  // capacity checks. Two concurrent finalizations for the same invoice
  // serialize on that lock; the second one re-reads the now-updated
  // allocation total and safely rejects if nothing is left to allocate.
  async finalizeCapturedPayment(
    paymentId: string,
    providerPaymentId: string,
    method?: string,
  ): Promise<Payment> {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) {
        throw new AppException(
          ErrorCode.PAYMENT_NOT_FOUND,
          'Payment not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (payment.status === 'CAPTURED') {
        return payment;
      }

      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${payment.invoiceId} FOR UPDATE`;

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: payment.invoiceId },
      });
      const allocatedAgg = await tx.paymentAllocation.aggregate({
        where: { invoiceId: payment.invoiceId },
        _sum: { amount: true },
      });
      const alreadyAllocated =
        allocatedAgg._sum.amount ?? new Prisma.Decimal(0);
      const remaining = invoice.total.minus(alreadyAllocated);

      if (invoice.status === 'VOID' || payment.amount.greaterThan(remaining)) {
        return tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            providerPaymentId,
            method,
            failureCode: 'OVERPAYMENT_REJECTED',
            failureMessage:
              'This invoice balance was already settled by another payment.',
          },
        });
      }

      await tx.paymentAllocation.create({
        data: {
          paymentId,
          invoiceId: payment.invoiceId,
          amount: payment.amount,
        },
      });

      const captured = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'CAPTURED',
          paidAt: new Date(),
          providerPaymentId,
          method,
        },
      });

      const newAllocatedTotal = alreadyAllocated.plus(payment.amount);
      const newInvoiceStatus = newAllocatedTotal.greaterThanOrEqualTo(
        invoice.total,
      )
        ? 'PAID'
        : 'PARTIALLY_PAID';
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: newInvoiceStatus },
      });

      // Payment vs settlement are separate facts (spec section 36) - the
      // tenant's payment is already CAPTURED at this point regardless of
      // what happens to the owner's settlement below.
      const ownerAccount = await tx.ownerPaymentAccount.findUnique({
        where: { organizationId: payment.organizationId },
      });
      await tx.ownerSettlement.create({
        data: {
          paymentId,
          organizationId: payment.organizationId,
          ownerPaymentAccountId: ownerAccount?.id ?? null,
          grossAmount: payment.amount,
          platformFee: payment.platformFee,
          settlementAmount: payment.ownerSettlementAmount,
          currency: payment.currency,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `PAYMENT_CAPTURED payment=${paymentId} invoice=${invoice.id} amount=${payment.amount.toString()}`,
      );
      return captured;
    });

    // Fired after the transaction has already committed (spec section
    // 46) - never inside it. Idempotency (spec section 32/76): both a
    // client-verify call and a webhook retry converge on this same
    // method, and both a genuinely-first finalize and a subsequent
    // already-CAPTURED early-return end up here - the event's own
    // `type:paymentId` idempotency key (see NotificationEventService)
    // is what collapses any resulting duplicate emission into exactly
    // one notification, not this call site.
    if (result.status === 'CAPTURED') {
      await this.eventBus.emit(NotificationType.RENT_PAYMENT_SUCCESS, {
        paymentId,
      });
    } else if (result.status === 'FAILED') {
      await this.eventBus.emit(NotificationType.RENT_PAYMENT_FAILED, {
        paymentId,
      });
    }
    return result;
  }

  async findForInvoice(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<PaymentResponseDto[]> {
    await this.getInvoiceForViewerOrThrow(user, invoiceId);
    const payments = await this.prisma.payment.findMany({
      where: { invoiceId },
      include: { settlement: true },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(PaymentResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.getAccessiblePaymentOrThrow(user, paymentId);
    return PaymentResponseDto.fromEntity(payment);
  }

  // Refund foundation (spec section 37) - OWNER/MANAGER-initiated, never
  // the tenant themselves (a tenant cannot unilaterally reverse their own
  // payment). Records the financial event and calls the gateway's real
  // refund API; if the payment's OwnerSettlement had already reached
  // PROCESSING/SETTLED, that settlement is flagged REVERSED as an
  // accounting fact - actually recovering funds already paid out to an
  // owner's linked account is a gateway-specific capability this phase
  // does not invent (see README's "Phase 6" section).
  async refund(
    user: AuthenticatedUser,
    paymentId: string,
    dto: RefundPaymentDto,
  ): Promise<PaymentResponseDto> {
    const payment = await this.getPaymentForOwnerOrThrow(user, paymentId);

    if (
      payment.status !== 'CAPTURED' &&
      payment.status !== 'PARTIALLY_REFUNDED'
    ) {
      throw new AppException(
        ErrorCode.REFUND_NOT_ALLOWED,
        `A payment with status ${payment.status} cannot be refunded.`,
        HttpStatus.CONFLICT,
      );
    }

    const priorRefunds = await this.prisma.refund.aggregate({
      where: { paymentId, status: 'PROCESSED' },
      _sum: { amount: true },
    });
    const alreadyRefunded = priorRefunds._sum.amount ?? new Prisma.Decimal(0);
    const refundableRemaining = payment.amount.minus(alreadyRefunded);
    const refundAmount = dto.amount
      ? new Prisma.Decimal(dto.amount)
      : refundableRemaining;

    if (
      refundAmount.lessThanOrEqualTo(0) ||
      refundAmount.greaterThan(refundableRemaining)
    ) {
      throw new AppException(
        ErrorCode.INVALID_PAYMENT_AMOUNT,
        `Refund amount must be between 0 and ${refundableRemaining.toString()}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const gatewayRefund = await this.gateway.refundPayment({
      providerPaymentId: payment.providerPaymentId!,
      amountInSmallestUnit: decimalToSmallestUnit(refundAmount),
      notes: dto.reason ? { reason: dto.reason } : undefined,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          paymentId,
          amount: refundAmount,
          reason: dto.reason,
          status: 'PROCESSED',
          providerRefundId: gatewayRefund.providerRefundId,
        },
      });

      const totalRefunded = alreadyRefunded.plus(refundAmount);
      const newStatus = totalRefunded.greaterThanOrEqualTo(payment.amount)
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { status: newStatus },
      });

      // Un-allocate the refunded amount so the invoice's outstanding
      // balance calculation reflects it, and step the invoice's status
      // back down if it is no longer fully covered.
      const allocation = await tx.paymentAllocation.findUnique({
        where: {
          payment_allocations_payment_invoice_unique: {
            paymentId,
            invoiceId: payment.invoiceId,
          },
        },
      });
      if (allocation) {
        const newAllocationAmount = Prisma.Decimal.max(
          allocation.amount.minus(refundAmount),
          new Prisma.Decimal(0),
        );
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: { amount: newAllocationAmount },
        });

        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: payment.invoiceId },
        });
        const remainingAgg = await tx.paymentAllocation.aggregate({
          where: { invoiceId: payment.invoiceId },
          _sum: { amount: true },
        });
        const stillAllocated =
          remainingAgg._sum.amount ?? new Prisma.Decimal(0);
        let nextInvoiceStatus = invoice.status;
        if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
          if (stillAllocated.lessThanOrEqualTo(0)) {
            nextInvoiceStatus =
              invoice.dueDate.getTime() < Date.now() ? 'OVERDUE' : 'ISSUED';
          } else if (stillAllocated.lessThan(invoice.total)) {
            nextInvoiceStatus = 'PARTIALLY_PAID';
          }
        }
        if (nextInvoiceStatus !== invoice.status) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: nextInvoiceStatus },
          });
        }
      }

      const settlement = await tx.ownerSettlement.findUnique({
        where: { paymentId },
      });
      if (
        settlement &&
        (settlement.status === 'PROCESSING' || settlement.status === 'SETTLED')
      ) {
        await tx.ownerSettlement.update({
          where: { id: settlement.id },
          data: {
            status: 'REVERSED',
            failureReason:
              'Underlying payment was refunded; owner settlement flagged for manual/gateway-side reversal.',
          },
        });
      }

      return updatedPayment;
    });

    this.logger.log(
      `PAYMENT_REFUNDED payment=${paymentId} amount=${refundAmount.toString()} by=${user.id}`,
    );
    return this.findOne(user, updated.id);
  }

  // Invoice.total minus the sum of successful (currently-allocated)
  // amounts - always Decimal arithmetic, never parseFloat (spec
  // section 15/39). A refund reduces a PaymentAllocation's amount rather
  // than deleting it, so this stays correct after a partial refund too.
  private async getOutstandingBalance(
    invoice: Pick<Invoice, 'id' | 'total'>,
  ): Promise<Prisma.Decimal> {
    const agg = await this.prisma.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amount: true },
    });
    const allocated = agg._sum.amount ?? new Prisma.Decimal(0);
    return Prisma.Decimal.max(
      invoice.total.minus(allocated),
      new Prisma.Decimal(0),
    );
  }

  // BOLA-safe lookup, fetched by id alone and then branched (the same
  // pattern TenantsService.findOne already established for a resource
  // with more than one legitimate viewer) - never scoped only to
  // organization membership the way InvoicesService's own lookup is,
  // because a tenant paying their own rent is not an organization member
  // at all (spec section 25).
  private async getInvoiceForPayerOrThrow(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceWithTenantAndOrg> {
    const invoice = await this.findInvoiceWithTenantAndOrg(invoiceId);
    if (!invoice) {
      throw this.invoiceNotFound();
    }
    if (
      user.platformRole !== 'SUPER_ADMIN' &&
      invoice.residency.tenant.userId !== user.id
    ) {
      throw this.invoiceNotFound();
    }
    return invoice;
  }

  // Viewer access additionally allows any active OWNER/MANAGER/STAFF
  // member of the owning organization (spec section 26 - read-only).
  private async getInvoiceForViewerOrThrow(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceWithTenantAndOrg> {
    const invoice = await this.findInvoiceWithTenantAndOrg(invoiceId);
    if (!invoice) {
      throw this.invoiceNotFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return invoice;
    }
    if (invoice.residency.tenant.userId === user.id) {
      return invoice;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      invoice.residency.organizationId,
    );
    if (membership) {
      return invoice;
    }
    throw this.invoiceNotFound();
  }

  private async findInvoiceWithTenantAndOrg(
    invoiceId: string,
  ): Promise<InvoiceWithTenantAndOrg | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        residency: {
          include: {
            tenant: true,
            property: { select: { organizationId: true } },
          },
        },
      },
    });
    if (!invoice) {
      return null;
    }
    const { residency, ...fields } = invoice;
    const { property, ...residencyFields } = residency;
    return {
      ...fields,
      residency: {
        ...residencyFields,
        tenant: residency.tenant,
        organizationId: property.organizationId,
      },
    } as InvoiceWithTenantAndOrg;
  }

  private async getPaymentForPayerOrThrow(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId },
    });
    if (
      !payment ||
      (user.platformRole !== 'SUPER_ADMIN' && payment.payerUserId !== user.id)
    ) {
      throw this.paymentNotFound();
    }
    return payment;
  }

  private async getPaymentForOwnerOrThrow(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
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
    this.memberships.assertRole(user, membership, ['OWNER', 'MANAGER']);
    return payment;
  }

  private async getAccessiblePaymentOrThrow(
    user: AuthenticatedUser,
    paymentId: string,
  ): Promise<Payment & { settlement: OwnerSettlement | null }> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId },
      include: { settlement: true },
    });
    if (!payment) {
      throw this.paymentNotFound();
    }
    if (
      user.platformRole === 'SUPER_ADMIN' ||
      payment.payerUserId === user.id
    ) {
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

  private toOrderResponse(payment: Payment): PaymentOrderResponseDto {
    const dto = new PaymentOrderResponseDto();
    dto.paymentId = payment.id;
    dto.providerOrderId = payment.providerOrderId ?? '';
    dto.amountInSmallestUnit = decimalToSmallestUnit(payment.amount);
    dto.amount = payment.amount.toString();
    dto.currency = payment.currency;
    dto.keyId = this.razorpayKeyId;
    return dto;
  }

  private invoiceNotFound(): AppException {
    return new AppException(
      ErrorCode.INVOICE_NOT_FOUND,
      'Invoice not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private paymentNotFound(): AppException {
    return new AppException(
      ErrorCode.PAYMENT_NOT_FOUND,
      'Payment not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private isUniqueViolation(error: unknown, indexName: string): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target.includes(indexName);
    }
    if (Array.isArray(target)) {
      return target.includes(indexName);
    }
    return false;
  }
}
