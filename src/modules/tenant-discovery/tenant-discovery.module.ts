import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { UsersModule } from '../users/users.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PropertyListingsController } from './controllers/property-listings.controller';
import { PublicPropertiesController } from './controllers/public-properties.controller';
import { ApplicationsController } from './controllers/applications.controller';
import { VisitsController } from './controllers/visits.controller';
import { MyApplicationsController } from './controllers/my-applications.controller';
import {
  MyApplicationVisitsController,
  MyVisitsController,
} from './controllers/my-visits.controller';
import { AdminDiscoveryController } from './controllers/admin-discovery.controller';
import { AdminListingsController } from './controllers/admin-listings.controller';
import { PropertyListingsService } from './services/property-listings.service';
import { PublicDiscoveryService } from './services/public-discovery.service';
import { TenantApplicationsService } from './services/tenant-applications.service';
import { ApplicationLifecycleService } from './services/application-lifecycle.service';
import { ApplicationConversionService } from './services/application-conversion.service';
import { ApplicationActivityService } from './services/application-activity.service';
import { PropertyVisitsService } from './services/property-visits.service';
import { AdminListingsService } from './services/admin-listings.service';

// The tenant ACQUISITION funnel - deliberately never imports
// ResidenciesModule/InvoicesModule/PaymentsModule back (spec's mandatory
// financial isolation: this module never creates a Residency/
// BedAllocation/Invoice/Payment, directly or transitively). Notification
// integration is one-directional too - this module only ever calls
// `DomainEventBusService.emit(...)` (global, no import needed); it never
// imports NotificationsModule, the same pattern every other business
// module in this codebase already follows (see NotificationEventService
// for where the Phase 12 handlers actually live).
@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    SubscriptionsModule,
    PlatformAdminModule,
    UsersModule,
    AuditLogModule,
  ],
  controllers: [
    PropertyListingsController,
    PublicPropertiesController,
    ApplicationsController,
    VisitsController,
    MyApplicationsController,
    MyVisitsController,
    MyApplicationVisitsController,
    AdminDiscoveryController,
    AdminListingsController,
  ],
  providers: [
    PropertyListingsService,
    PublicDiscoveryService,
    TenantApplicationsService,
    ApplicationLifecycleService,
    ApplicationConversionService,
    ApplicationActivityService,
    PropertyVisitsService,
    AdminListingsService,
  ],
  exports: [TenantApplicationsService, PropertyVisitsService],
})
export class TenantDiscoveryModule {}
