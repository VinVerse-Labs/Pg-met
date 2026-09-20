import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SaasPlansModule } from '../saas-plans/saas-plans.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  AdminOrganizationsController,
  AdminOwnersController,
  AdminPropertiesController,
  AdminSubscriptionsController,
} from './platform-admin.controller';
import { AdminSaasPlansController } from './admin-saas-plans.controller';
import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Module({
  imports: [AuthModule, SaasPlansModule, AuditLogModule],
  controllers: [
    AdminOrganizationsController,
    AdminOwnersController,
    AdminPropertiesController,
    AdminSubscriptionsController,
    AdminSaasPlansController,
    AdminAuditLogsController,
  ],
  providers: [PlatformAdminService, PlatformAdminGuard],
  exports: [PlatformAdminGuard],
})
export class PlatformAdminModule {}
