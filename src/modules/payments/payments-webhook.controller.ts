import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsWebhookService } from './payments-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

// Deliberately no JwtAuthGuard - Razorpay calls this, not a logged-in
// user (spec section 31). Excluded from Swagger since it's not a
// client-facing endpoint and documenting it publicly would be pointless
// (it can only ever be called by Razorpay's own signed request).
@ApiExcludeController()
@Controller('payments/webhooks')
export class PaymentsWebhookController {
  constructor(private readonly webhookService: PaymentsWebhookService) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: RawBodyRequest,
  ): Promise<{ ok: true }> {
    const signature = req.header('x-razorpay-signature');
    const eventId = req.header('x-razorpay-event-id');
    await this.webhookService.processRazorpayWebhook(
      req.rawBody ?? Buffer.from(JSON.stringify(req.body)),
      signature,
      req.body,
      eventId,
    );
    return { ok: true };
  }
}
