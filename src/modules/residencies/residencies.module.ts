import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { FoodModule } from '../food/food.module';
import { PropertyResidenciesController } from './property-residencies.controller';
import { ResidenciesController } from './residencies.controller';
import { ResidenciesService } from './residencies.service';

@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    PropertiesModule,
    TenantsModule,
    // Phase 10: checkout must end any active food subscription for the
    // residency (spec section 49) - a one-directional dependency, FoodModule
    // never imports anything back from ResidenciesModule.
    FoodModule,
  ],
  controllers: [PropertyResidenciesController, ResidenciesController],
  providers: [ResidenciesService],
  exports: [ResidenciesService],
})
export class ResidenciesModule {}
