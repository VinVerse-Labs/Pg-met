import { Module } from '@nestjs/common';
import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import { RazorpayGatewayService } from './razorpay-gateway.service';

// Hoisted out of PaymentsModule (Phase 6) so both PaymentsModule and
// SubscriptionPaymentsModule (Phase 7) can depend on the same
// PAYMENT_GATEWAY provider without a circular module dependency between
// them - see README's "Phase 7" section for why PaymentsModule also needs
// to reach SubscriptionPaymentsService (webhook dispatch) while
// SubscriptionPaymentsModule must not need anything back from
// PaymentsModule.
@Module({
  providers: [{ provide: PAYMENT_GATEWAY, useClass: RazorpayGatewayService }],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
