import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PaymentGatewayModule } from './gateway/payment-gateway.module';
import { SubscriptionPaymentsModule } from '../subscription-payments/subscription-payments.module';
import { FoodModule } from '../food/food.module';
import { PlatformFeeService } from './platform-fee.service';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { InvoicePaymentsController } from './invoice-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';

@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    PaymentGatewayModule,
    // Phase 7's webhook dispatch: the same Razorpay webhook URL delivers
    // both tenant-rent and SaaS-subscription events, so
    // PaymentsWebhookService needs to reach SubscriptionPaymentsService
    // too - see PaymentGatewayModule's doc comment for why this is a
    // one-directional dependency (SubscriptionPaymentsModule never
    // imports PaymentsModule back).
    SubscriptionPaymentsModule,
    // Phase 10: the same webhook dispatch reasoning as
    // SubscriptionPaymentsModule above - FoodModule never imports
    // anything back from PaymentsModule.
    FoodModule,
  ],
  controllers: [
    InvoicePaymentsController,
    PaymentsController,
    PaymentsWebhookController,
  ],
  providers: [PaymentsService, PaymentsWebhookService, PlatformFeeService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
