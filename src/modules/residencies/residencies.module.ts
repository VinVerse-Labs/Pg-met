import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PropertyResidenciesController } from './property-residencies.controller';
import { ResidenciesController } from './residencies.controller';
import { ResidenciesService } from './residencies.service';

@Module({
  imports: [AuthModule, MembershipsModule, PropertiesModule, TenantsModule],
  controllers: [PropertyResidenciesController, ResidenciesController],
  providers: [ResidenciesService],
  exports: [ResidenciesService],
})
export class ResidenciesModule {}
