import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SaasPlansController } from './saas-plans.controller';
import { SaasPlansService } from './saas-plans.service';

@Module({
  imports: [AuthModule],
  controllers: [SaasPlansController],
  providers: [SaasPlansService],
  exports: [SaasPlansService],
})
export class SaasPlansModule {}
