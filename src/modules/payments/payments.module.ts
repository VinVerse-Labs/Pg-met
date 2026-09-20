import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { RazorpayGatewayService } from './gateway/razorpay-gateway.service';
import { PlatformFeeService } from './platform-fee.service';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { InvoicePaymentsController } from './invoice-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [
    InvoicePaymentsController,
    PaymentsController,
    PaymentsWebhookController,
  ],
  providers: [
    PaymentsService,
    PaymentsWebhookService,
    PlatformFeeService,
    { provide: PAYMENT_GATEWAY, useClass: RazorpayGatewayService },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
