import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { RazorpayConfig } from '../../../config/configuration';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import {
  CreateGatewayOrderInput,
  CreateGatewayOrderResult,
  CreateTransferInput,
  CreateTransferResult,
  FetchGatewayPaymentResult,
  PaymentGateway,
  RefundPaymentInput,
  RefundPaymentResult,
  VerifyPaymentSignatureInput,
} from './payment-gateway.interface';

// The only Razorpay-specific module in this codebase (spec section 27 -
// "keep provider-specific code isolated"). Every method here talks to the
// real Razorpay SDK/HMAC scheme; nothing outside this class knows what
// "razorpay_signature" or "x-razorpay-signature" even are.
@Injectable()
export class RazorpayGatewayService implements PaymentGateway {
  private readonly logger = new Logger(RazorpayGatewayService.name);
  private readonly client: InstanceType<typeof Razorpay>;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(configService: ConfigService) {
    const config = configService.get<RazorpayConfig>('razorpay')!;
    this.keySecret = config.keySecret!;
    this.webhookSecret = config.webhookSecret!;
    this.client = new Razorpay({
      key_id: config.keyId,
      key_secret: config.keySecret,
    });
  }

  async createOrder(
    input: CreateGatewayOrderInput,
  ): Promise<CreateGatewayOrderResult> {
    try {
      const order = await this.client.orders.create({
        amount: input.amountInSmallestUnit,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      });
      return { providerOrderId: order.id };
    } catch (error) {
      this.logger.error(`RAZORPAY_CREATE_ORDER_FAILED ${String(error)}`);
      throw new AppException(
        ErrorCode.PAYMENT_GATEWAY_ERROR,
        'Could not create a payment order with the gateway.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // HMAC-SHA256(order_id + "|" + payment_id, key_secret) === signature -
  // Razorpay's own documented checkout verification formula. Never trust
  // the client's own "payment succeeded" claim without this (spec
  // section 42).
  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
    const payload = `${input.providerOrderId}|${input.providerPaymentId}`;
    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(payload)
      .digest('hex');
    return this.timingSafeEqual(expected, input.signature);
  }

  // HMAC-SHA256 over the exact raw request body, keyed with the separate
  // webhook secret (never the API key secret) - Razorpay's documented
  // webhook verification formula (spec section 31).
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!signatureHeader) {
      return false;
    }
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return this.timingSafeEqual(expected, signatureHeader);
  }

  async fetchPayment(
    providerPaymentId: string,
  ): Promise<FetchGatewayPaymentResult> {
    try {
      const payment = await this.fetchWithOneRetry(providerPaymentId);
      return { status: payment.status, method: payment.method };
    } catch (error) {
      this.logger.error(`RAZORPAY_FETCH_PAYMENT_FAILED ${String(error)}`);
      throw new AppException(
        ErrorCode.PAYMENT_GATEWAY_ERROR,
        'Could not fetch payment status from the gateway.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // A read, so safe to repeat. Measured against Razorpay's test API: the SDK
  // intermittently fails with a connection-level error (no HTTP response -
  // it surfaces as "Cannot read properties of undefined (reading 'status')"),
  // which made a valid, possibly-captured payment's verify a 502. Only that
  // no-response case is retried, once; a real Razorpay error response (it
  // carries a statusCode) is not.
  private async fetchWithOneRetry(
    providerPaymentId: string,
  ): Promise<{ status: string; method?: string }> {
    try {
      return await this.client.payments.fetch(providerPaymentId);
    } catch (error) {
      const hasResponse =
        typeof (error as { statusCode?: unknown })?.statusCode === 'number';
      if (hasResponse) throw error;
      this.logger.warn(
        `RAZORPAY_FETCH_PAYMENT_RETRY payment=${providerPaymentId} ${String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.client.payments.fetch(providerPaymentId);
    }
  }

  // Route/marketplace split-settlement transfer to the owner's linked
  // account (spec section 21) - a real gateway call, never a fake
  // internal ledger entry pretending to be one.
  async createTransfer(
    input: CreateTransferInput,
  ): Promise<CreateTransferResult> {
    try {
      const transfer = await this.client.payments.transfer(
        input.providerPaymentId,
        {
          transfers: [
            {
              account: input.destinationAccountId,
              amount: input.amountInSmallestUnit,
              currency: input.currency,
              notes: input.notes,
            },
          ],
        },
      );
      const item = transfer.items[0];
      return { providerTransferId: item.id, status: item.status };
    } catch (error) {
      this.logger.error(`RAZORPAY_CREATE_TRANSFER_FAILED ${String(error)}`);
      throw new AppException(
        ErrorCode.PAYMENT_GATEWAY_ERROR,
        'Could not create an owner settlement transfer with the gateway.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    try {
      const refund = await this.client.payments.refund(
        input.providerPaymentId,
        { amount: input.amountInSmallestUnit, notes: input.notes },
      );
      return { providerRefundId: refund.id, status: refund.status };
    } catch (error) {
      this.logger.error(`RAZORPAY_REFUND_FAILED ${String(error)}`);
      throw new AppException(
        ErrorCode.PAYMENT_GATEWAY_ERROR,
        'Could not process the refund with the gateway.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private timingSafeEqual(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
