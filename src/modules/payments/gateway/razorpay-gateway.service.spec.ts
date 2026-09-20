import * as crypto from 'crypto';
import { RazorpayGatewayService } from './razorpay-gateway.service';

function configService(overrides: Partial<any> = {}) {
  return {
    get: jest.fn().mockReturnValue({
      keyId: 'rzp_test_key',
      keySecret: 'test-key-secret',
      webhookSecret: 'test-webhook-secret',
      ...overrides,
    }),
  } as any;
}

describe('RazorpayGatewayService (signature verification)', () => {
  let service: RazorpayGatewayService;

  beforeEach(() => {
    service = new RazorpayGatewayService(configService());
  });

  describe('verifyPaymentSignature', () => {
    it('accepts a signature computed with Razorpay’s documented HMAC formula', () => {
      const providerOrderId = 'order_abc';
      const providerPaymentId = 'pay_xyz';
      const signature = crypto
        .createHmac('sha256', 'test-key-secret')
        .update(`${providerOrderId}|${providerPaymentId}`)
        .digest('hex');

      expect(
        service.verifyPaymentSignature({
          providerOrderId,
          providerPaymentId,
          signature,
        }),
      ).toBe(true);
    });

    it('rejects a tampered signature', () => {
      expect(
        service.verifyPaymentSignature({
          providerOrderId: 'order_abc',
          providerPaymentId: 'pay_xyz',
          signature: 'not-the-real-signature',
        }),
      ).toBe(false);
    });

    it('rejects a signature computed with the wrong key secret', () => {
      const signature = crypto
        .createHmac('sha256', 'wrong-secret')
        .update('order_abc|pay_xyz')
        .digest('hex');

      expect(
        service.verifyPaymentSignature({
          providerOrderId: 'order_abc',
          providerPaymentId: 'pay_xyz',
          signature,
        }),
      ).toBe(false);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts an HMAC computed over the exact raw body with the webhook secret', () => {
      const rawBody = Buffer.from('{"event":"payment.captured"}');
      const signature = crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(rawBody)
        .digest('hex');

      expect(service.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects when the body was modified after signing', () => {
      const originalBody = Buffer.from('{"event":"payment.captured"}');
      const signature = crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(originalBody)
        .digest('hex');
      const tamperedBody = Buffer.from(
        '{"event":"payment.captured","amount":999999}',
      );

      expect(service.verifyWebhookSignature(tamperedBody, signature)).toBe(
        false,
      );
    });

    it('rejects a missing signature header', () => {
      expect(service.verifyWebhookSignature(Buffer.from('{}'), '')).toBe(false);
    });
  });
});
