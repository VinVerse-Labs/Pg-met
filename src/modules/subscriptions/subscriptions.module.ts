import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SaasPlansModule } from '../saas-plans/saas-plans.module';
import { SubscriptionInvoicesModule } from '../subscription-invoices/subscription-invoices.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessGuard } from './subscription-access.guard';

@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    SaasPlansModule,
    SubscriptionInvoicesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionAccessGuard],
  exports: [SubscriptionsService, SubscriptionAccessGuard],
})
export class SubscriptionsModule {}
