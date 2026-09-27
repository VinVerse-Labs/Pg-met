import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { MyTenantController, TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [TenantsController, MyTenantController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
