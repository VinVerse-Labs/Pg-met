import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { MembershipRoleGuard } from './guards/membership-role.guard';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    OrganizationMembershipGuard,
    MembershipRoleGuard,
  ],
  exports: [MembershipsModule],
})
export class OrganizationsModule {}
