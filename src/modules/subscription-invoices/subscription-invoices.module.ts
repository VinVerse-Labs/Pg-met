import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import {
  OrganizationSubscriptionInvoicesController,
  SubscriptionInvoicesController,
} from './subscription-invoices.controller';
import { SubscriptionInvoicesService } from './subscription-invoices.service';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [
    OrganizationSubscriptionInvoicesController,
    SubscriptionInvoicesController,
  ],
  providers: [SubscriptionInvoicesService],
  exports: [SubscriptionInvoicesService],
})
export class SubscriptionInvoicesModule {}
