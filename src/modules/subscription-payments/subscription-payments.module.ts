import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PaymentGatewayModule } from '../payments/gateway/payment-gateway.module';
import { SubscriptionInvoicesModule } from '../subscription-invoices/subscription-invoices.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import {
  OrganizationSubscriptionPaymentsController,
  SubscriptionInvoicePaymentsController,
  SubscriptionPaymentsController,
} from './subscription-payments.controller';
import { SubscriptionPaymentsService } from './subscription-payments.service';

// Deliberately never imports PaymentsModule (Phase 6) - see
// PaymentGatewayModule's doc comment for why the dependency runs the
// other way (PaymentsModule -> SubscriptionPaymentsModule, for webhook
// dispatch), never both directions.
@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    PaymentGatewayModule,
    SubscriptionInvoicesModule,
    SubscriptionsModule,
  ],
  controllers: [
    SubscriptionInvoicePaymentsController,
    OrganizationSubscriptionPaymentsController,
    SubscriptionPaymentsController,
  ],
  providers: [SubscriptionPaymentsService],
  exports: [SubscriptionPaymentsService],
})
export class SubscriptionPaymentsModule {}
