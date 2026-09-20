import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ResidenciesModule } from '../residencies/residencies.module';
import { ResidencyRentPlanController } from './residency-rent-plan.controller';
import { RentPlansController } from './rent-plans.controller';
import { RentPlansService } from './rent-plans.service';

@Module({
  imports: [AuthModule, MembershipsModule, ResidenciesModule],
  controllers: [ResidencyRentPlanController, RentPlansController],
  providers: [RentPlansService],
  exports: [RentPlansService],
})
export class RentPlansModule {}
