import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeBillingController } from './controllers/me-billing.controller';
import { MyStayService } from './services/my-stay.service';
import { MyBillingService } from './services/my-billing.service';

// Tenant self-service reads (GET /me/residency, /me/rent, /me/invoices,
// /me/payments). Read-only by design: it only queries through Prisma,
// scoped to the caller, and imports no other business module - so it can
// never become a second write path for residencies, invoices or payments.
@Module({
  imports: [AuthModule],
  controllers: [MeBillingController],
  providers: [MyStayService, MyBillingService],
})
export class MeModule {}
