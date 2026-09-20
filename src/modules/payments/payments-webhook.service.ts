import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './gateway/payment-gateway.interface';
import { PaymentsService } from './payments.service';

interface RazorpayWebhookPaymentEntity {
  id?: string;
  order_id?: string;
  method?: string;
  error_code?: string;
  error_description?: string;
}

interface RazorpayWebhookPayload {
  event: string;
  payload?: {
    payment?: {
      entity?: RazorpayWebhookPaymentEntity;
    };
  };
}

// Everything specific to "a Razorpay webhook arrived" lives here, kept
// separate from PaymentsService (which knows nothing about webhook
// envelopes/signatures) - PaymentsWebhookController is the only caller.
@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // Verify -> dedupe (provider, eventId) -> finalize. Every step before
  // "dedupe" runs on every delivery, including retries; every step after
  // is skipped on a duplicate delivery (spec sections 31-33).
  async processRazorpayWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    body: RazorpayWebhookPayload,
    eventIdHeader?: string,
  ): Promise<void> {
    if (
      !signatureHeader ||
      !this.gateway.verifyWebhookSignature(rawBody, signatureHeader)
    ) {
      throw new AppException(
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Webhook signature verification failed.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const paymentEntity = body.payload?.payment?.entity;
    // Razorpay does not send a stable top-level event id on every API
    // version - prefer the `x-razorpay-event-id` header when the account
    // has it enabled, otherwise fall back to a deterministic key from the
    // event type + gateway payment id, which is unique per real-world
    // occurrence of "this payment reached this state".
    const eventId =
      eventIdHeader ?? `${body.event}:${paymentEntity?.id ?? 'unknown'}`;

    let webhookEvent;
    try {
      webhookEvent = await this.prisma.webhookEvent.create({
        data: {
          provider: 'RAZORPAY',
          eventId,
          eventType: body.event,
          payload: body as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        this.isUniqueViolation(error, [
          'webhook_events_provider_event_unique',
          'provider',
          'eventId',
        ])
      ) {
        this.logger.log(`WEBHOOK_DUPLICATE_IGNORED event=${eventId}`);
        return;
      }
      throw error;
    }

    await this.handleEvent(body, paymentEntity);

    await this.prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processedAt: new Date() },
    });
  }

  private async handleEvent(
    body: RazorpayWebhookPayload,
    paymentEntity: RazorpayWebhookPaymentEntity | undefined,
  ): Promise<void> {
    if (!paymentEntity?.order_id) {
      this.logger.warn(`WEBHOOK_MISSING_ORDER_ID event=${body.event}`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: paymentEntity.order_id },
    });
    if (!payment) {
      // A payment made outside our order-creation flow, or for a payment
      // this instance never created - safe to acknowledge and ignore
      // rather than fail the webhook delivery.
      this.logger.warn(
        `WEBHOOK_NO_MATCHING_PAYMENT order=${paymentEntity.order_id}`,
      );
      return;
    }

    if (body.event === 'payment.captured') {
      await this.paymentsService.finalizeCapturedPayment(
        payment.id,
        paymentEntity.id!,
        paymentEntity.method,
      );
      return;
    }

    if (body.event === 'payment.failed') {
      if (payment.status === 'CREATED' || payment.status === 'PENDING') {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            providerPaymentId: paymentEntity.id,
            failureCode: paymentEntity.error_code,
            failureMessage: paymentEntity.error_description,
          },
        });
      }
    }
  }

  // Prisma's P2002 `target` is not consistently the constraint's SQL name
  // across providers/versions - against the real Postgres engine it comes
  // back as the array of column names (e.g. `['provider', 'eventId']`),
  // not the name given to `@@unique(..., name: "...")`. Matching against
  // any of "the declared constraint name" or "the column names it covers"
  // makes this robust to both shapes rather than trusting one - a bug
  // caught by running this exact check against the live database, not
  // just the mocked unit tests (see the Phase 6 final report).
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
