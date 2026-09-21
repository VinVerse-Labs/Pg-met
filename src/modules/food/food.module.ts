import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PropertiesModule } from '../properties/properties.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentGatewayModule } from '../payments/gateway/payment-gateway.module';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FoodConfigurationController } from './controllers/food-configuration.controller';
import { FoodPlansController } from './controllers/food-plans.controller';
import { FoodMenusController } from './controllers/food-menus.controller';
import { FoodSubscriptionsController } from './controllers/food-subscriptions.controller';
import { FoodPaymentsController } from './controllers/food-payments.controller';
import { MealConsumptionController } from './controllers/meal-consumption.controller';
import { MyFoodController } from './controllers/my-food.controller';
import { AdminFoodController } from './controllers/admin-food.controller';
import { FoodConfigurationService } from './services/food-configuration.service';
import { FoodPlansService } from './services/food-plans.service';
import { FoodEntitlementService } from './services/food-entitlement.service';
import { FoodMenusService } from './services/food-menus.service';
import { FoodSubscriptionsService } from './services/food-subscriptions.service';
import { FoodBillingService } from './services/food-billing.service';
import { MealConsumptionService } from './services/meal-consumption.service';
import { MyFoodService } from './services/my-food.service';

// Deliberately never imports PaymentsModule/SubscriptionPaymentsModule
// back (see PaymentGatewayModule's own doc comment for the dependency
// direction this preserves) - PaymentsModule imports FoodModule instead,
// for webhook dispatch (see PaymentsWebhookService), and ResidenciesModule
// imports FoodModule for the checkout-cancels-active-subscription hook
// (see ResidenciesService.checkOut) - both are one-directional.
@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    PropertiesModule,
    SubscriptionsModule,
    PaymentGatewayModule,
    PlatformAdminModule,
    AuditLogModule,
  ],
  controllers: [
    FoodConfigurationController,
    FoodPlansController,
    FoodMenusController,
    FoodSubscriptionsController,
    FoodPaymentsController,
    MealConsumptionController,
    MyFoodController,
    AdminFoodController,
  ],
  providers: [
    FoodConfigurationService,
    FoodPlansService,
    FoodEntitlementService,
    FoodMenusService,
    FoodSubscriptionsService,
    FoodBillingService,
    MealConsumptionService,
    MyFoodService,
  ],
  exports: [FoodSubscriptionsService, FoodBillingService],
})
export class FoodModule {}
